import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import { AMBER_INSTRUCTIONS } from "../../../lib/amber-instructions";
import { generateAmberOutput, type AmberOutput } from "../../../lib/amber-output";
import {
  checkChatHistory,
  deriveHistoryKey,
  sessionIdFromToken,
  signAssistantTurn,
} from "../../../lib/amber-history";

// Metadane wiadomości Amber (wewnętrzna logika aplikacji).
// UWAGA: trafiają do przeglądarki razem z wiadomością, więc NIE są poufne.
// `sig` = podpis HMAC odpowiedzi (W3) – chroni historię przed sfałszowaniem.
type AmberMetadata = Omit<AmberOutput, "draft"> & { sig: string };
type AmberUIMessage = UIMessage<AmberMetadata>;

// Ten plik działa tylko na serwerze. Klucz API nigdy nie trafia do przeglądarki.
export async function POST(req: Request) {
  // 1. Najpierw sesja. Bez ważnej sesji: 401 i żadnego wywołania modelu.
  const authConfig = getAuthConfig();
  const sessionToken = readCookie(req, SESSION_COOKIE);
  if (!authConfig || !sessionToken || !isSessionValid(sessionToken, authConfig)) {
    return new Response(
      authConfig
        ? "Brak dostępu: zaloguj się hasłem warsztatowym."
        : "Dostęp zablokowany: brak konfiguracji CHAT_PASSWORD / SESSION_SECRET.",
      { status: 401 },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;

  if (!apiKey || !modelId) {
    return new Response(
      "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom ponownie serwer (npm run dev).",
      { status: 500 },
    );
  }

  // Cała historia bieżącej rozmowy, wysłana przez useChat.
  const { messages }: { messages: AmberUIMessage[] } = await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Brak wiadomości do wysłania.", { status: 400 });
  }

  // W3: kontrola danych z przeglądarki i podpisów odpowiedzi Amber – PRZED wywołaniem modelu.
  const historyKey = deriveHistoryKey(authConfig.secret);
  const sessionId = sessionIdFromToken(sessionToken);
  const history = checkChatHistory(messages, { key: historyKey, sessionId });
  if (!history.ok) {
    console.warn(`[Amber] Odrzucono historię rozmowy (${history.reason}).`);
    return new Response(history.message, { status: 400 });
  }

  // Do modelu trafia wyłącznie sprawdzony tekst (role user/assistant), bez metadanych i plików.
  const modelMessages: ModelMessage[] = history.turns.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));

  const openrouter = createOpenRouter({ apiKey });

  // 2. Structured output: model musi zwrócić JSON zgodny ze schematem,
  //    a serwer sprawdza go PRZED wysłaniem czegokolwiek do przeglądarki.
  const result = await generateAmberOutput({
    model: openrouter(modelId),
    // Instrukcja systemowa (persona, wiedza o firmie, zasady, format wyniku) – tylko po stronie serwera.
    instructions: AMBER_INSTRUCTIONS,
    messages: modelMessages,
    abortSignal: req.signal, // „Wyjdź” / przerwanie połączenia zatrzymuje też zapytanie do modelu
  });

  // 3. Błędny wynik jest odrzucany – nigdy nie zamieniamy go na pozornie poprawny.
  if (!result.ok) {
    console.error(`[Amber] Odrzucono odpowiedź modelu (${result.kind}): ${result.details}`);
    return new Response(result.message, { status: 502 });
  }

  // Ślad w logach serwera (okno npm run dev / logi Vercel): pełny, sprawdzony wynik.
  console.log("[Amber] Sprawdzony wynik:", JSON.stringify(result.output));

  // 4. Klient widzi tylko treść pola draft. Pozostałe pola to metadane wiadomości.
  const { draft, ...outputMeta } = result.output;

  // W3: podpis nowej odpowiedzi – obejmuje sesję, całą rozmowę i metadane.
  const sig = signAssistantTurn(
    historyKey,
    sessionId,
    [...history.turns, { role: "assistant", text: draft }],
    outputMeta,
  );
  const metadata: AmberMetadata = { ...outputMeta, sig };

  const stream = createUIMessageStream<AmberUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata });
      writer.write({ type: "text-start", id: "draft" });
      writer.write({ type: "text-delta", id: "draft", delta: draft });
      writer.write({ type: "text-end", id: "draft" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
