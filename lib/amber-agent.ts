// Warsztat 3 (lekcja 3): jeden endpoint /api/agent z dwoma trybami.
//   mode=chat    – streamText, zwykła odpowiedź tekstowa, narzędzia wybierane przez model
//                  (web_search, aktualnyCzas, sprawdzObszar, informacjeOUrzadzeniu, generujObraz),
//                  stopWhen: isStepCount(5), podpis HMAC v5 odpowiedzi.
//   mode=analyze – generateText + Output.object + walidator (generateAmberOutput z lekcji 2),
//                  analiza wyłącznie tekstu z pola wejściowego, bez historii i bez narzędzi.
//
// Ten plik działa tylko na serwerze. Zależności (sesja, modele, podpisy) są przekazywane z zewnątrz,
// żeby logikę dało się przetestować bez Next.js i bez OpenRouter (scripts/test-amber-agent.mjs).

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";
import type {
  AgentTurnInfo,
  ChatTurn,
  HistoryCheck,
  TurnSource,
} from "./amber-history";
import type { AmberResult } from "./amber-output";

export const AGENT_MODES = ["chat", "analyze"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

// Narzędzia, których części mogą trafić do przeglądarki (inne są pomijane).
export const AGENT_TOOL_NAMES = [
  "web_search",
  "aktualnyCzas",
  "sprawdzObszar",
  "informacjeOUrzadzeniu",
  "generujObraz",
] as const;
// Etykiety użytych narzędzi w metadanych (te same nazwy co w lib/amber-history.ts).
const LABEL_ORDER = ["wyszukiwanie", "aktualnyCzas", "sprawdzObszar", "informacjeOUrzadzeniu", "generujObraz"] as const;
const MAX_STREAM_SOURCES = 6;

export const AGENT_MESSAGES = {
  unauthorized: "Brak dostępu: zaloguj się hasłem warsztatowym.",
  badRequest: "Nieprawidłowe zapytanie. Odśwież stronę i spróbuj ponownie.",
  badMode: "Nieprawidłowy tryb (mode). Dozwolone wartości: chat, analyze.",
  config:
    "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom ponownie serwer (npm run dev).",
  emptyText: "Wpisz tekst do analizy.",
  providerError: "Wystąpił błąd dostawcy AI (OpenRouter). Spróbuj ponownie za chwilę.",
} as const;

export type AgentDeps = {
  // 1. Sesja (wywoływana jako pierwsza). null = brak ważnej sesji → 401.
  getSession: (req: Request) => { secret: string; token: string } | null;
  // 2. Modele i narzędzia – tworzone dopiero po sprawdzeniu sesji. null = brak konfiguracji → 500.
  createModels: () => { model: LanguageModel; tools: ToolSet } | null;
  instructions: { chat: string; analyze: string };
  history: {
    deriveHistoryKey: (secret: string) => Buffer;
    sessionIdFromToken: (token: string) => string;
    checkChatHistory: (messages: unknown, ctx: { key: Buffer; sessionId: string }) => HistoryCheck;
    signAgentChatTurn: (key: Buffer, sessionId: string, history: ChatTurn[], info: AgentTurnInfo) => string;
  };
  generateAmberOutput: (options: {
    model: LanguageModel;
    instructions: string;
    messages: ModelMessage[];
    abortSignal?: AbortSignal;
    maxRetries?: number;
  }) => Promise<AmberResult>;
  maxTextChars: number;
  maxRetries?: number;
  now?: () => Date;
  log?: (message: string) => void;
};

type AgentMetadata = { kind: "chat"; sig: string; fetchedAt?: string; tools?: string[]; model?: string };
type AgentUIMessage = UIMessage<AgentMetadata>;

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Data i godzina pobrania źródeł, czas Londynu (np. „11.11.2026, 14:45”).
export function formatFetchedAt(date: Date): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Sprawdzone tury → wiadomości dla modelu (tylko tekst; zdjęcie klienta jako część „image”).
// Ta sama zasada co w app/api/chat/route.ts.
export function toModelMessages(turns: ChatTurn[]): ModelMessage[] {
  return turns.map((turn): ModelMessage => {
    if (turn.role === "assistant") {
      return { role: "assistant", content: turn.text.trim() ? turn.text : "[Amber przekazała klientowi wygenerowany obraz.]" };
    }
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
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function createAgentHandler(deps: AgentDeps) {
  const log = deps.log ?? ((message: string) => console.log(message));
  const now = deps.now ?? (() => new Date());

  return async function handleAgentRequest(req: Request): Promise<Response> {
    // 1. Najpierw sesja. Bez ważnej sesji: 401 – przed odczytem treści i przed wywołaniem modelu.
    const session = deps.getSession(req);
    if (!session) return text(AGENT_MESSAGES.unauthorized, 401);

    // 2. Treść zapytania i tryb.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text(AGENT_MESSAGES.badRequest, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return text(AGENT_MESSAGES.badRequest, 400);
    }
    const mode = (body as { mode?: unknown }).mode;
    if (typeof mode !== "string" || !(AGENT_MODES as readonly string[]).includes(mode)) {
      return text(AGENT_MESSAGES.badMode, 400);
    }

    // mode=analyze: tylko tekst z pola wejściowego – sprawdzany przed wywołaniem modelu.
    let analyzeText = "";
    if (mode === "analyze") {
      const value = (body as { text?: unknown }).text;
      if (typeof value !== "string") return text(AGENT_MESSAGES.badRequest, 400);
      analyzeText = value.trim();
      if (!analyzeText) return text(AGENT_MESSAGES.emptyText, 400);
      if (analyzeText.length > deps.maxTextChars) {
        return text(`Tekst jest za długi (maksymalnie ${deps.maxTextChars} znaków).`, 400);
      }
    }

    // mode=chat: kontrola historii i podpisów (v4 i v5) – PRZED wywołaniem modelu.
    let turns: ChatTurn[] = [];
    let historyKey: Buffer | null = null;
    let sessionId = "";
    if (mode === "chat") {
      historyKey = deps.history.deriveHistoryKey(session.secret);
      sessionId = deps.history.sessionIdFromToken(session.token);
      const history = deps.history.checkChatHistory((body as { messages?: unknown }).messages, {
        key: historyKey,
        sessionId,
      });
      if (!history.ok) {
        console.warn(`[Amber] /api/agent: odrzucono historię rozmowy (${history.reason}).`);
        return text(history.message, 400);
      }
      turns = history.turns;
    }

    // 3. Konfiguracja modelu (klucz i model tylko po stronie serwera).
    const models = deps.createModels();
    if (!models) return text(AGENT_MESSAGES.config, 500);

    if (mode === "analyze") {
      // generateText + Output.object + validateAmberOutput (lekcja 2) – bez historii i bez narzędzi.
      const result = await deps.generateAmberOutput({
        model: models.model,
        instructions: deps.instructions.analyze,
        messages: [{ role: "user", content: analyzeText }],
        abortSignal: req.signal,
        maxRetries: deps.maxRetries,
      });
      if (!result.ok) {
        console.error(`[Amber] /api/agent analyze: odrzucono odpowiedź modelu (${result.kind}): ${result.details}`);
        return text(result.message, 502);
      }
      log(`[Amber] /api/agent analyze – sprawdzony wynik: ${JSON.stringify(result.output)}`);
      return Response.json({ analysis: result.output, ...(result.modelId ? { model: result.modelId } : {}) });
    }

    return streamChat({ req, deps, models, turns, historyKey: historyKey!, sessionId, log, now });
  };
}

// mode=chat: streamText → strumień do useChat. Podpis v5 wysyłany na końcu (finish → metadane).
function streamChat({
  req,
  deps,
  models,
  turns,
  historyKey,
  sessionId,
  log,
  now,
}: {
  req: Request;
  deps: AgentDeps;
  models: { model: LanguageModel; tools: ToolSet };
  turns: ChatTurn[];
  historyKey: Buffer;
  sessionId: string;
  log: (message: string) => void;
  now: () => Date;
}): Response {
  const askedAboutImage = Boolean(turns[turns.length - 1]?.image);

  const result = streamText({
    model: models.model,
    instructions: deps.instructions.chat,
    messages: toModelMessages(turns),
    tools: models.tools,
    stopWhen: isStepCount(5),
    abortSignal: req.signal,
    maxRetries: deps.maxRetries,
  });

  const stream = createUIMessageStream<AgentUIMessage>({
    execute: async ({ writer }) => {
      // Dokładnie to, co zapisze przeglądarka – na tej podstawie liczymy podpis.
      type Step = { textOrder: string[]; texts: Map<string, string>; sources: TurnSource[]; toolNames: string[] };
      const done: Step[] = [];
      const newStep = (): Step => ({ textOrder: [], texts: new Map(), sources: [], toolNames: [] });
      let step = newStep();
      const seenUrls = new Set<string>();
      const allowedCalls = new Set<string>();
      let hadError = false;
      let finishReason: string | undefined;

      for await (const chunk of result.toUIMessageStream<AgentUIMessage>({
        sendSources: true,
        sendReasoning: false,
        sendFinish: false,
        // Szczegóły błędu tylko w logach serwera; przeglądarka dostaje komunikat po polsku.
        onError: (error) => {
          const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          console.error(`[Amber] /api/agent chat – błąd modelu: ${details.slice(0, 500)}`);
          return AGENT_MESSAGES.providerError;
        },
      })) {
        switch (chunk.type) {
          case "text-start":
            step.textOrder.push(chunk.id);
            step.texts.set(chunk.id, "");
            writer.write(chunk);
            break;
          case "text-delta":
            step.texts.set(chunk.id, (step.texts.get(chunk.id) ?? "") + chunk.delta);
            writer.write(chunk);
            break;
          case "source-url": {
            // Tylko http/https, bez powtórzeń, najwyżej 6 (tak samo sprawdza historia).
            const all = [...done.flatMap((s) => s.sources), ...step.sources];
            if (!isHttpUrl(chunk.url) || seenUrls.has(chunk.url) || all.length >= MAX_STREAM_SOURCES) break;
            seenUrls.add(chunk.url);
            const title = typeof chunk.title === "string" ? chunk.title.trim().slice(0, 200) : "";
            step.sources.push({ url: chunk.url, title });
            writer.write({ type: "source-url", sourceId: chunk.sourceId, url: chunk.url, title });
            break;
          }
          case "tool-input-start":
          case "tool-input-available":
          case "tool-input-error":
            // Tylko znane narzędzia (inne części byłyby odrzucone przez kontrolę historii).
            if (!(AGENT_TOOL_NAMES as readonly string[]).includes(chunk.toolName) || chunk.dynamic) break;
            if (!allowedCalls.has(chunk.toolCallId)) {
              allowedCalls.add(chunk.toolCallId);
              step.toolNames.push(chunk.toolName);
            }
            writer.write(chunk);
            break;
          case "tool-input-delta":
          case "tool-output-available":
          case "tool-output-error":
          case "tool-output-denied":
            if (allowedCalls.has(chunk.toolCallId)) writer.write(chunk);
            break;
          case "start":
          case "start-step":
          case "text-end":
          case "finish-step":
          case "abort":
            writer.write(chunk);
            break;
          case "reset-step":
            step = newStep();
            writer.write(chunk);
            break;
          case "error":
            hadError = true;
            writer.write(chunk);
            break;
          case "finish":
            finishReason = chunk.finishReason;
            break;
          default:
            // reasoning, pliki, dokumenty, dane własne – nie trafiają do przeglądarki.
            break;
        }
        if (chunk.type === "finish-step") {
          done.push(step);
          step = newStep();
        }
      }
      done.push(step);

      // Bez podpisu, gdy odpowiedź jest niepełna (błąd lub przerwanie) – takiej odpowiedzi nie da się użyć w historii.
      if (hadError || req.signal.aborted) {
        writer.write({ type: "finish", finishReason: "error" });
        return;
      }

      const replyText = done.map((s) => s.textOrder.map((id) => s.texts.get(id) ?? "").join("")).join("");
      const sources = done.flatMap((s) => s.sources);
      const called = new Set(done.flatMap((s) => s.toolNames));
      const tools = LABEL_ORDER.filter((name) =>
        name === "wyszukiwanie" ? sources.length > 0 : called.has(name),
      );
      const fetchedAt = sources.length > 0 ? formatFetchedAt(now()) : "";
      let model = "";
      if (askedAboutImage) {
        const response = await result.response;
        model = typeof response?.modelId === "string" ? response.modelId.slice(0, 120) : "";
      }

      const sig = deps.history.signAgentChatTurn(
        historyKey,
        sessionId,
        [...turns, { role: "assistant", text: replyText }],
        { sources, fetchedAt, tools, model },
      );
      const metadata: AgentMetadata = {
        kind: "chat",
        sig,
        ...(fetchedAt ? { fetchedAt } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(model ? { model } : {}),
      };

      if (sources.length > 0) log(`[Amber] /api/agent – źródła (${sources.length}): ${sources.map((s) => s.url).join(" | ")}`);
      if (tools.length > 0) log(`[Amber] /api/agent – użyte narzędzia: ${tools.join(", ")}`);
      if (askedAboutImage) log(`[Amber] /api/agent – zdjęcie przeanalizował model: ${model || "(brak w odpowiedzi API)"}`);

      // „tool-calls” na końcu = model zatrzymany limitem kroków (stopWhen: isStepCount(5)) – przeglądarka pokaże komunikat.
      let finalReason = finishReason;
      try {
        finalReason = (await result.finishReason) ?? finalReason;
      } catch {
        // brak informacji – zostaje wartość ze strumienia
      }
      if (finalReason === "tool-calls") log("[Amber] /api/agent – osiągnięto limit 5 kroków.");

      writer.write({ type: "finish", finishReason: (finalReason as "stop") ?? "stop", messageMetadata: metadata });
    },
    onError: (error) => {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[Amber] /api/agent chat – błąd strumienia: ${details.slice(0, 500)}`);
      return AGENT_MESSAGES.providerError;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
