import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { after } from "next/server";
import type { ToolSet } from "ai";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import {
  AMBER_ANALYZE_INSTRUCTIONS,
  AMBER_CHAT_INSTRUCTIONS,
  AMBER_CHAT_INSTRUCTIONS_DEV,
} from "../../../lib/amber-instructions";
import { generateAmberOutput } from "../../../lib/amber-output";
import { checkArea, informacjeOUrzadzeniu, sprawdzObszar } from "../../../lib/amber-tools";
import { createDiagnosticsTool, createNotesTool, czas, kalkulator } from "../../../lib/amber-tools-local";
import {
  createCrimeTool,
  createCurrencyTool,
  createHolidaysTool,
  createWeatherTool,
  createWikipediaTool,
} from "../../../lib/amber-tools-api";
import { IMAGE_MODEL_ID, createImageTool } from "../../../lib/amber-image";
import {
  MAX_USER_MESSAGE_CHARS,
  checkChatHistory,
  deriveHistoryKey,
  sessionIdFromToken,
  signAgentChatTurn,
} from "../../../lib/amber-history";
import { createAgentHandler } from "../../../lib/amber-agent";
import { getConversationStore, getProfileStore } from "../../../lib/supabase";
import { createProfileTool, profileInstructions } from "../../../lib/amber-profile";

// Warsztat 3: jeden endpoint, dwa tryby (mode=chat, mode=analyze). Logika: lib/amber-agent.ts.
// Ten plik działa tylko na serwerze – klucz API nie trafia do przeglądarki.
// Diagnostyka tylko w środowisku testowym (`npm run dev`). Po `npm run build` (także na Vercelu) NODE_ENV = "production".
const DEV_DIAGNOSTICS = process.env.NODE_ENV === "development";

export async function POST(req: Request) {
  const handle = createAgentHandler({
    // 1. Sesja – sprawdzana jako pierwsza (bez niej 401).
    getSession: (request) => {
      const authConfig = getAuthConfig();
      const token = readCookie(request, SESSION_COOKIE);
      if (!authConfig || !token || !isSessionValid(token, authConfig)) return null;
      return { secret: authConfig.secret, token };
    },
    // 2. Model i narzędzia – dopiero po sprawdzeniu sesji.
    createModels: ({ sessionId }) => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      const modelId = process.env.OPENROUTER_MODEL;
      if (!apiKey || !modelId) return null;
      const openrouter = createOpenRouter({ apiKey });

      // Generowanie obrazu: osobny klient, który odczytuje pole "model" z odpowiedzi API (jeśli API je poda).
      let apiImageModel: string | undefined;
      const imageProvider = createOpenRouter({
        apiKey,
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          try {
            const data: unknown = await response.clone().json();
            const model = (data as { model?: unknown } | null)?.model;
            if (typeof model === "string" && model.length > 0) apiImageModel = model;
          } catch {
            // odpowiedź bez JSON – zostaje identyfikator z metadanych AI SDK
          }
          return response;
        },
      });

      const tools: ToolSet = {
        web_search: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
        sprawdzObszar,
        informacjeOUrzadzeniu,
        generujObraz: createImageTool({
          model: imageProvider.imageModel(IMAGE_MODEL_ID),
          apiModelId: () => apiImageModel,
        }),
        // Lekcja 4: osiem narzędzi pomocniczych ("czas" zastępuje dawne "aktualnyCzas").
        pogoda: createWeatherTool(),
        waluty: createCurrencyTool(),
        swieta: createHolidaysTool(),
        wikipedia: createWikipediaTool(),
        // Lekcja 4, Warsztat 1 (Fast): statystyki zgłoszeń policji; obszar działania liczy ta sama funkcja co sprawdzObszar.
        przestepczosc: createCrimeTool({}, { areaCheck: checkArea }),
        kalkulator,
        czas,
        notatki: createNotesTool(sessionId),
      };
      // Lekcja 5, Warsztat 3: zapis faktów o kliencie w user_profiles (tylko gdy Supabase jest skonfigurowany).
      const profileStore = getProfileStore();
      if (profileStore) tools.zapiszProfil = createProfileTool(profileStore);
      if (DEV_DIAGNOSTICS) {
        // Tylko przy npm run dev. Zwraca „konfiguracja kompletna: tak/nie” – bez nazw zmiennych i wartości.
        tools.diagnostyka = createDiagnosticsTool({ env: process.env });
      }
      return { model: openrouter(modelId), tools };
    },
    instructions: { chat: DEV_DIAGNOSTICS ? AMBER_CHAT_INSTRUCTIONS_DEV : AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput,
    maxTextChars: MAX_USER_MESSAGE_CHARS,
    // Lekcja 5, Warsztat 2: zapis rozmów w Supabase (po sprawdzeniu sesji i po zakończeniu odpowiedzi).
    conversations: getConversationStore,
    // Lekcja 5, Warsztat 3: profil klienta jako dane w instrukcjach (przed każdą odpowiedzią).
    profileInstructions: async () => {
      const store = getProfileStore();
      return store ? profileInstructions(await store.load()) : "";
    },
    // Dla szybkich: tytuł nowej rozmowy od modelu – po wysłaniu odpowiedzi (after z Next.js; błąd tylko w logu).
    runAfterResponse: (task) =>
      after(async () => {
        try {
          await task();
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          console.error(`[Amber] /api/agent – tytuł rozmowy nie zapisany: ${details.slice(0, 300)}`);
        }
      }),
  });
  return handle(req);
}
