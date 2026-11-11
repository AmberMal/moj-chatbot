import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import { AMBER_INSTRUCTIONS } from "../../../lib/amber-instructions";
import { generateAmberOutput, type AmberOutput, type AmberToolName } from "../../../lib/amber-output";
import { aktualnyCzas, informacjeOUrzadzeniu, sprawdzObszar } from "../../../lib/amber-tools";
import {
  checkChatHistory,
  deriveHistoryKey,
  sessionIdFromToken,
  signAssistantTurn,
} from "../../../lib/amber-history";

// Metadane wiadomości Amber (wewnętrzna logika aplikacji).
// UWAGA: trafiają do przeglądarki razem z wiadomością, więc NIE są poufne.
// `sig` = podpis HMAC odpowiedzi (W3) – chroni historię przed sfałszowaniem.
// `fetchedAt` = data i godzina pobrania źródeł z internetu (lekcja 3), tylko gdy są źródła.
// `tools` = nazwy użytych narzędzi (etykiety nad odpowiedzią), tylko gdy jakieś użyto.
type AmberMetadata = Omit<AmberOutput, "draft"> & {
  sig: string;
  fetchedAt?: string;
  tools?: AmberToolName[];
  model?: string;
};

// Data i godzina pobrania źródeł, czas Londynu (np. „10.11.2026, 18:45”).
function formatFetchedAt(date: Date): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
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
  // Lekcja 3 (Vision): zdjęcie klienta trafia do modelu jako część „image”.
  const modelMessages: ModelMessage[] = history.turns.map((turn): ModelMessage => {
    if (turn.role === "assistant") return { role: "assistant", content: turn.text };
    if (turn.image) {
      return {
        role: "user",
        content: [
          { type: "text", text: turn.text.trim() || "Klient przesłał zdjęcie." },
          { type: "image", image: turn.image.base64, mediaType: turn.image.mediaType },
        ],
      };
    }
    return { role: "user", content: turn.text.trim() ? turn.text : "[Klient przesłał wcześniej zdjęcie.]" };
  });
  const askedAboutImage = Boolean(history.turns[history.turns.length - 1].image);

  const openrouter = createOpenRouter({ apiKey });

  // 2. Structured output: model musi zwrócić JSON zgodny ze schematem,
  //    a serwer sprawdza go PRZED wysłaniem czegokolwiek do przeglądarki.
  const result = await generateAmberOutput({
    model: openrouter(modelId),
    // Instrukcja systemowa (persona, wiedza o firmie, zasady, format wyniku) – tylko po stronie serwera.
    instructions: AMBER_INSTRUCTIONS,
    messages: modelMessages,
    // Lekcja 3: wyszukiwanie w internecie (narzędzie OpenRouter, wykonywane po stronie OpenRouter).
    tools: {
      web_search: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
      // Lekcja 3: nasza funkcja (function calling) – data, dzień tygodnia, godzina w Londynie.
      aktualnyCzas,
      // Lekcja 3: narzędzia firmowe – wstępne sprawdzenie kodu pocztowego i obsługiwanej marki.
      sprawdzObszar,
      informacjeOUrzadzeniu,
    },
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

  // Lekcja 3: źródła z wyszukiwania (już oczyszczone: tylko http/https, bez duplikatów).
  const sources = result.sources;
  const fetchedAt = sources.length > 0 ? formatFetchedAt(new Date()) : "";
  if (sources.length > 0) {
    console.log(`[Amber] Źródła (${sources.length}):`, sources.map((source) => source.url).join(" | "));
  }
  const tools = result.tools;
  if (tools.length > 0) console.log(`[Amber] Użyte narzędzia: ${tools.join(", ")}`);
  // Przy odpowiedzi o zdjęciu: identyfikator modelu z odpowiedzi API.
  const model = askedAboutImage ? result.modelId : "";
  if (askedAboutImage) console.log(`[Amber] Zdjęcie przeanalizował model: ${model || "(brak w odpowiedzi API)"}`);

  // W3: podpis nowej odpowiedzi – obejmuje sesję, całą rozmowę, źródła i metadane.
  const sig = signAssistantTurn(
    historyKey,
    sessionId,
    [...history.turns, { role: "assistant", text: draft }],
    outputMeta,
    sources,
    fetchedAt,
    tools,
    model,
  );
  const metadata: AmberMetadata = {
    ...outputMeta,
    sig,
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(model ? { model } : {}),
  };

  const stream = createUIMessageStream<AmberUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata });
      writer.write({ type: "text-start", id: "draft" });
      writer.write({ type: "text-delta", id: "draft", delta: draft });
      writer.write({ type: "text-end", id: "draft" });
      // Źródła trafiają do przeglądarki jako części „source-url” (jak sendSources w toUIMessageStream).
      sources.forEach((source, index) => {
        writer.write({ type: "source-url", sourceId: `source-${index}`, url: source.url, title: source.title });
      });
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
