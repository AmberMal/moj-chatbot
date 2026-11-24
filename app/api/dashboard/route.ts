import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { getCurrentUser } from "../../../lib/auth";
import { AMBER_COMPARE_INSTRUCTIONS, AMBER_DASHBOARD_INSTRUCTIONS } from "../../../lib/amber-instructions";
import { geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia } from "../../../lib/amber-tools-api";
import { timeIn } from "../../../lib/amber-tools-local";
import { createDashboardHandler } from "../../../lib/amber-dashboard";

// Lekcja 4, Warsztat 3 (Minimum/Standard/Fast): dane Dashboardu podróży. Logika: lib/amber-dashboard.ts.
// Ten plik działa tylko na serwerze – klucz API nie trafia do przeglądarki.
export async function POST(req: Request) {
  // Ten sam model co czat, bez narzędzi. Brak konfiguracji → „Podsumowanie/Rekomendacja niedostępna”.
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  const ask =
    apiKey && modelId
      ? async (instructions: string, content: string) => {
          const openrouter = createOpenRouter({ apiKey });
          const result = await generateText({
            model: openrouter(modelId),
            instructions,
            messages: [{ role: "user", content }],
            abortSignal: req.signal,
          });
          return result.text;
        }
      : null;

  const handle = createDashboardHandler({
    // 1. Zalogowana osoba – sprawdzana jako pierwsza (zweryfikowana sesja Supabase; bez niej 401).
    hasSession: async () => (await getCurrentUser()) !== null,
    // Te same funkcje, z których korzystają narzędzia agenta.
    sources: {
      geocodeCity: (miasto) => geocodeCity(miasto),
      getWeather: (input, place) => getWeather(input, {}, place),
      getCurrency: (input) => getCurrency(input),
      getHolidays: (input) => getHolidays(input),
      getWikipedia: (input) => getWikipedia(input),
      timeIn: (strefa, now) => timeIn(strefa, now),
    },
    // Podsumowanie agenta (jedno miasto).
    summarize: ask
      ? (input) =>
          ask(
            AMBER_DASHBOARD_INSTRUCTIONS,
            `Miasto: ${input.miasto}${input.kraj ? ` (${input.kraj})` : ""}, data podróży: ${input.data}.\n` +
              `Brak danych z: ${input.brakujaceZrodla.length > 0 ? input.brakujaceZrodla.join(", ") : "—"}.\n` +
              `Dane z kart (JSON):\n${JSON.stringify(input.karty)}`,
          )
      : null,
    // Fast: rekomendacja jednego z dwóch miast (tryb „Porównaj”).
    recommend: ask
      ? (input) =>
          ask(
            AMBER_COMPARE_INSTRUCTIONS,
            `Wspólna data podróży: ${input.data}.\n` +
              `Do wyboru (pierwsza linia „MIASTO: …”): ${input.miasta.map((m) => m.miasto).join(" albo ")}.\n\n` +
              input.miasta
                .map(
                  (m, i) =>
                    `Miasto ${i + 1}: ${m.miasto}${m.kraj ? ` (${m.kraj})` : ""}.\n` +
                    `Brak danych z: ${m.brakujaceZrodla.length > 0 ? m.brakujaceZrodla.join(", ") : "—"}.\n` +
                    `Dane z kart (JSON):\n${JSON.stringify(m.karty)}`,
                )
                .join("\n\n"),
          )
      : null,
  });
  return handle(req);
}
