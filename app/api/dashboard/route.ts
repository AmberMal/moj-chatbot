import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import { AMBER_DASHBOARD_INSTRUCTIONS } from "../../../lib/amber-instructions";
import { geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia } from "../../../lib/amber-tools-api";
import { timeIn } from "../../../lib/amber-tools-local";
import { createDashboardHandler } from "../../../lib/amber-dashboard";

// Lekcja 4, Warsztat 3 (Minimum): dane Dashboardu podróży. Logika: lib/amber-dashboard.ts.
// Ten plik działa tylko na serwerze – klucz API nie trafia do przeglądarki.
export async function POST(req: Request) {
  const handle = createDashboardHandler({
    // 1. Sesja – sprawdzana jako pierwsza (bez niej 401).
    hasSession: (request) => {
      const authConfig = getAuthConfig();
      const token = readCookie(request, SESSION_COOKIE);
      return Boolean(authConfig && token && isSessionValid(token, authConfig));
    },
    // Te same funkcje, z których korzystają narzędzia agenta.
    sources: {
      geocodeCity: (miasto) => geocodeCity(miasto),
      getWeather: (input, place) => getWeather(input, {}, place),
      getCurrency: (input) => getCurrency(input),
      getHolidays: (input) => getHolidays(input),
      getWikipedia: (input) => getWikipedia(input),
      timeIn: (strefa, now) => timeIn(strefa, now),
    },
    // Podsumowanie agenta (ten sam model co czat, bez narzędzi). Brak konfiguracji → „Podsumowanie niedostępne”.
    summarize: (() => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      const modelId = process.env.OPENROUTER_MODEL;
      if (!apiKey || !modelId) return null;
      return async (input) => {
        const openrouter = createOpenRouter({ apiKey });
        const result = await generateText({
          model: openrouter(modelId),
          instructions: AMBER_DASHBOARD_INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content:
                `Miasto: ${input.miasto}${input.kraj ? ` (${input.kraj})` : ""}, data podróży: ${input.data}.\n` +
                `Brak danych z: ${input.brakujaceZrodla.length > 0 ? input.brakujaceZrodla.join(", ") : "—"}.\n` +
                `Dane z kart (JSON):\n${JSON.stringify(input.karty)}`,
            },
          ],
          abortSignal: req.signal,
        });
        return result.text;
      };
    })(),
  });
  return handle(req);
}
