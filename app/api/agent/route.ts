import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import { AMBER_ANALYZE_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS } from "../../../lib/amber-instructions";
import { generateAmberOutput } from "../../../lib/amber-output";
import { aktualnyCzas, informacjeOUrzadzeniu, sprawdzObszar } from "../../../lib/amber-tools";
import { IMAGE_MODEL_ID, createImageTool } from "../../../lib/amber-image";
import {
  MAX_USER_MESSAGE_CHARS,
  checkChatHistory,
  deriveHistoryKey,
  sessionIdFromToken,
  signAgentChatTurn,
} from "../../../lib/amber-history";
import { createAgentHandler } from "../../../lib/amber-agent";

// Warsztat 3: jeden endpoint, dwa tryby (mode=chat, mode=analyze). Logika: lib/amber-agent.ts.
// Ten plik działa tylko na serwerze – klucz API nie trafia do przeglądarki.
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
    createModels: () => {
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

      return {
        model: openrouter(modelId),
        tools: {
          web_search: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
          aktualnyCzas,
          sprawdzObszar,
          informacjeOUrzadzeniu,
          generujObraz: createImageTool({
            model: imageProvider.imageModel(IMAGE_MODEL_ID),
            apiModelId: () => apiImageModel,
          }),
        },
      };
    },
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput,
    maxTextChars: MAX_USER_MESSAGE_CHARS,
  });
  return handle(req);
}
