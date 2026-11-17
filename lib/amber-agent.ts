// Warsztat 3 (lekcja 3): jeden endpoint /api/agent z dwoma trybami.
//   mode=chat    – streamText, zwykła odpowiedź tekstowa, narzędzia wybierane przez model
//                  (web_search, sprawdzObszar, informacjeOUrzadzeniu, generujObraz oraz z lekcji 4:
//                  pogoda, waluty, swieta, wikipedia, kalkulator, czas, notatki, diagnostyka, przestepczosc),
//                  stopWhen: isStepCount(6) (lekcja 4, ReAct), podpis HMAC v5 odpowiedzi.
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
import type { ConversationStore } from "./amber-conversations";

export const AGENT_MODES = ["chat", "analyze"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

// Narzędzia, których części mogą trafić do przeglądarki (inne są pomijane).
// "aktualnyCzas" zostaje na liście tylko dla zgodności (zastąpione narzędziem "czas" w lekcji 4).
export const AGENT_TOOL_NAMES = [
  "web_search",
  "aktualnyCzas",
  "sprawdzObszar",
  "informacjeOUrzadzeniu",
  "generujObraz",
  "pogoda",
  "waluty",
  "swieta",
  "wikipedia",
  "kalkulator",
  "czas",
  "notatki",
  "diagnostyka",
  "przestepczosc",
] as const;
// Etykiety użytych narzędzi w metadanych (te same nazwy co w lib/amber-history.ts).
const LABEL_ORDER = [
  "wyszukiwanie",
  "aktualnyCzas",
  "czas",
  "sprawdzObszar",
  "przestepczosc",
  "informacjeOUrzadzeniu",
  "pogoda",
  "waluty",
  "swieta",
  "wikipedia",
  "kalkulator",
  "notatki",
  "diagnostyka",
  "generujObraz",
] as const;
// Lekcja 4, Warsztat 2 (ReAct): najwyżej 6 kroków modelu na jedno zadanie. Wszystkie mogą używać narzędzi.
// Jeśli po ostatnim kroku agent nadal chce użyć narzędzia, serwer zatrzymuje pętlę i dopisuje
// komunikat „Zatrzymałem się po N krokach” z podsumowaniem rzeczywistych wyników narzędzi.
export const AGENT_STEP_LIMIT = 6;
export const stepLimitMessage = (limit: number) => `Zatrzymałem się po ${limit} krokach`;

// Lekcja 4 – limit wywołań narzędzi w jednym zadaniu (= limit części narzędzi w historii, 16).
// Warsztat 2 (Standard): najwyżej 16 wywołań narzędzi na zadanie – liczone osobno od limitu 6 kroków modelu.
// Warstwa A: wywołanie ponad limit NIE jest wykonywane – model dostaje tylko komunikat o pominięciu,
//            a przeglądarka nie dostaje jego części. Nic, z czego model skorzystał, nie jest ukrywane.
//            Jedno miejsce jest zawsze zarezerwowane dla obrazu (generujObraz).
// Warstwa B: po AGENT_TOOL_SOFT_LIMIT wywołaniach kolejne kroki nie mogą używać narzędzi (toolChoice: "none").
// Musi być równe MAX_AGENT_TOOL_PARTS z lib/amber-history.ts (sprawdza to test; pliki lib/ nie importują się w czasie działania).
export const AGENT_TOOL_CALL_LIMIT = 16;
export const AGENT_TOOL_SOFT_LIMIT = 14;
const IMAGE_TOOL_NAME = "generujObraz";
export const TOOL_SKIPPED_MESSAGE =
  "Pominięto: osiągnięto limit narzędzi w jednej odpowiedzi. Odpowiedz na podstawie dotychczasowych wyników " +
  "i powiedz klientowi, czego nie sprawdziłaś – może zapytać o to w kolejnej wiadomości.";

// Lekcja 4, Warsztat 2 (Standard): limity czasu.
// – całe zadanie: najwyżej 60 s. Po 45 s model nie dostaje już narzędzi (ma odpowiedzieć tym, co wie);
//   po 60 s serwer przerywa model i dopisuje podsumowanie z rzeczywistych wyników narzędzi (wynik częściowy);
// – jedno narzędzie: najwyżej 10 s czekania na wynik, potem „Źródło nie odpowiada”
//   (bez generujObraz – generowanie obrazu trwa dłużej; obejmuje je limit 60 s całego zadania).
export const AGENT_TASK_TIMEOUT_MS = 60_000;
export const AGENT_TASK_SOFT_DEADLINE_MS = 45_000;
export const AGENT_TOOL_TIMEOUT_MS = 10_000;
export const TOOL_TIMEOUT_EXCLUDED = [IMAGE_TOOL_NAME] as const;
export const SOURCE_TIMEOUT_MESSAGE = "Źródło nie odpowiada";
export const TOOL_REPEAT_MESSAGE =
  "Pominięto: to samo wywołanie już się nie powiodło – nie powtarzam go. Odpowiedz na podstawie dotychczasowych " +
  "wyników i powiedz klientowi wprost, czego nie udało się sprawdzić.";
export const taskTimeoutMessage = (ms: number) => `Przerwałam zadanie po ${Math.round(ms / 1000)} sekundach (limit czasu)`;

// Wspólny „budżet” wywołań jednej odpowiedzi. Decyzja dla danego toolCallId zapada raz i jest stała –
// tak samo widzi ją filtr strumienia (części dla przeglądarki) i wykonanie narzędzia.
export function createToolBudget(limit: number = AGENT_TOOL_CALL_LIMIT) {
  const decisions = new Map<string, boolean>();
  let admitted = 0;
  let admittedOther = 0;
  return {
    admit(toolCallId: string, toolName: string): boolean {
      const known = decisions.get(toolCallId);
      if (known !== undefined) return known;
      const isImage = toolName === IMAGE_TOOL_NAME;
      const ok = admitted < limit && (isImage || admittedOther < limit - 1);
      decisions.set(toolCallId, ok);
      if (ok) {
        admitted++;
        if (!isImage) admittedOther++;
      }
      return ok;
    },
    get used() {
      return decisions.size;
    },
    get admitted() {
      return admitted;
    },
  };
}
export type ToolBudget = ReturnType<typeof createToolBudget>;

// Narzędzia z naszym kodem (execute) sprawdzają budżet przed wykonaniem. Narzędzia wykonywane
// przez dostawcę (web_search) nie mają execute – je pilnuje filtr strumienia i warstwa B.
export function withToolBudget(tools: ToolSet, budget: ToolBudget): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = (original as { execute?: (input: unknown, options: { toolCallId: string }) => unknown }).execute;
    if (typeof execute !== "function") {
      wrapped[name] = original;
      continue;
    }
    wrapped[name] = {
      ...original,
      execute: async (input: unknown, options: { toolCallId: string }) => {
        if (!budget.admit(options.toolCallId, name)) return { ok: false, pominieto: true, komunikat: TOOL_SKIPPED_MESSAGE };
        return execute.call(original, input, options);
      },
    } as ToolSet[string];
  }
  return wrapped;
}

// Warsztat 2 (Standard): nieudane wywołania (ok: false, wyjątek, przekroczony czas) są zapamiętywane.
// Ponowne IDENTYCZNE wywołanie (ta sama nazwa i te same dane) nie jest wykonywane, a kolejny krok
// modelu dostaje toolChoice: "none" – agent kończy z wynikiem częściowym zamiast powtarzać błąd w pętli.
// executed – liczba faktycznie wykonanych wywołań (licznik pod odpowiedzią).
export function createToolGuard() {
  const failed = new Set<string>();
  let executed = 0;
  let blockedRepeats = 0;
  const key = (name: string, input: unknown) => `${name}|${JSON.stringify(input ?? null)}`;
  return {
    isRepeatOfFailure: (name: string, input: unknown) => failed.has(key(name, input)),
    recordFailure: (name: string, input: unknown) => void failed.add(key(name, input)),
    countExecution: () => void executed++,
    countBlockedRepeat: () => void blockedRepeats++,
    get executed() {
      return executed;
    },
    get blockedRepeats() {
      return blockedRepeats;
    },
  };
}
export type ToolGuard = ReturnType<typeof createToolGuard>;

const isFailedResult = (output: unknown) => {
  const o = output as { ok?: unknown; pominieto?: unknown } | null;
  return typeof o === "object" && o !== null && o.ok === false && o.pominieto !== true;
};

// Nakładka na narzędzia z naszym kodem (execute): blokada powtórzeń + limit czasu jednego narzędzia.
// Przekroczony czas → wynik { ok: false, komunikat: "Źródło nie odpowiada" } (zwykły wynik, nie błąd aplikacji).
export function withToolGuards(
  tools: ToolSet,
  guard: ToolGuard,
  timeoutMs: number = AGENT_TOOL_TIMEOUT_MS,
  excluded: readonly string[] = TOOL_TIMEOUT_EXCLUDED,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    type Exec = (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => unknown;
    const execute = (original as { execute?: Exec }).execute;
    if (typeof execute !== "function") {
      wrapped[name] = original;
      continue;
    }
    wrapped[name] = {
      ...original,
      execute: async (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => {
        if (guard.isRepeatOfFailure(name, input)) {
          guard.countBlockedRepeat();
          return { ok: false, pominieto: true, powtorzenie: true, komunikat: TOOL_REPEAT_MESSAGE };
        }
        guard.countExecution();
        const run = async () => execute.call(original, input, options);
        let output: unknown;
        try {
          if (excluded.includes(name)) {
            output = await run();
          } else {
            const controller = new AbortController();
            const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<{ ok: false; komunikat: string }>((resolve) => {
              timer = setTimeout(() => {
                controller.abort();
                resolve({ ok: false, komunikat: SOURCE_TIMEOUT_MESSAGE });
              }, timeoutMs);
            });
            try {
              output = await Promise.race([execute.call(original, input, { ...options, abortSignal: signal }), timeout]);
            } finally {
              clearTimeout(timer);
            }
          }
        } catch (error) {
          guard.recordFailure(name, input);
          throw error;
        }
        if (isFailedResult(output)) guard.recordFailure(name, input);
        return output;
      },
    } as ToolSet[string];
  }
  return wrapped;
}

// Liczniki pod odpowiedzią (tylko do wyświetlenia – NIE są podpisywane; przeglądarka usuwa je z historii).
export type AgentStats = { kroki: number; narzedzia: number; czasMs: number };

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
  //    sessionId – identyfikator sesji (np. dla notatek oddzielnych w każdej sesji).
  createModels: (ctx: { sessionId: string }) => { model: LanguageModel; tools: ToolSet } | null;
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
  // Limit kroków (domyślnie AGENT_STEP_LIMIT = 6). Inna wartość tylko w testach.
  stepLimit?: number;
  // Warsztat 2 (Standard): limity czasu (domyślnie 60 s / 45 s / 10 s). Inne wartości tylko w testach.
  taskTimeoutMs?: number;
  taskSoftDeadlineMs?: number;
  toolTimeoutMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
  // Lekcja 5, Warsztat 2: zapis rozmów w bazie (null / brak = bez zapisu, czat działa dalej).
  conversations?: () => ConversationStore | null;
};

// conversationId (lekcja 5) – numer rozmowy w bazie; jak stats służy tylko przeglądarce i nie wraca na serwer.
type AgentMetadata = {
  kind: "chat";
  sig: string;
  fetchedAt?: string;
  tools?: string[];
  model?: string;
  stats?: AgentStats;
  conversationId?: number;
};
type AgentUIMessage = UIMessage<AgentMetadata>;

// Lekcja 5: numer rozmowy z przeglądarki. Brak / null = nowa rozmowa; inna wartość niż dodatnia liczba całkowita = błąd 400.
export function parseConversationId(value: unknown): { ok: true; id: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, id: null };
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return { ok: true, id: value };
  return { ok: false };
}

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

function isWikipediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pl.wikipedia.org";
  } catch {
    return false;
  }
}

type AgentUIChunk = Parameters<Parameters<Parameters<typeof createUIMessageStream<AgentUIMessage>>[0]["execute"]>[0]["writer"]["write"]>[0];

// Kopia fragmentu strumienia bez pól z wewnętrznymi danymi dostawcy (providerMetadata itp.).
export function withoutProviderMetadata<T>(chunk: T): T {
  if (typeof chunk !== "object" || chunk === null) return chunk;
  const { providerMetadata: _p, callProviderMetadata: _c, ...rest } = chunk as Record<string, unknown>;
  return rest as T;
}

// ---------------------------------------------------------------------------
// ReAct: podsumowanie po limicie kroków – tylko z rzeczywistych wyników narzędzi (bez dodatkowego wywołania modelu).
// ---------------------------------------------------------------------------
export type StepResult = { step: number; name: string; input: unknown; kind: "ok" | "error" | "inputError"; output?: unknown };

const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pl-PL", { maximumFractionDigits: 4 }) : "?");
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Jedna linia z wyniku narzędzia. null = pomiń (np. wywołanie pominięte przez limit narzędzi).
export function describeToolResult(r: StepResult): string | null {
  if (r.kind === "inputError") return `${r.name}: nieprawidłowe dane wejściowe – nie wykonano`;
  if (r.kind === "error") return `${r.name}: błąd narzędzia – brak wyniku`;
  const o = (typeof r.output === "object" && r.output !== null ? r.output : {}) as Record<string, unknown>;
  if (o.pominieto === true) return null;
  if (o.ok === false) return `${r.name}: ${str(o.komunikat) || str(o.message) || "brak wyniku"}`;
  switch (r.name) {
    case "pogoda":
      return `pogoda (${str(o.miasto)}, ${str(o.data)}): ${num(o.temperaturaMinC)}–${num(o.temperaturaMaxC)}°C, ${str(o.opis)}, opady ${num(o.opadyMm)} mm`;
    case "waluty":
      return (
        `waluty: 1 ${str(o.kod)} = ${num(o.kursPLN)} zł (NBP, ${str(o.dataKursu)})` +
        (typeof o.kwota === "number" ? `; ${num(o.kwota)} ${str(o.kod)} = ${num(o.kwotaPLN)} zł` : "")
      );
    case "swieta": {
      const list = Array.isArray(o.swieta) ? (o.swieta as Array<Record<string, unknown>>) : [];
      const first = list.slice(0, 3).map((h) => `${str(h.data)} ${str(h.nazwaLokalna)}`).join(", ");
      return `swieta (${str(o.kraj)}, ${num(o.rok).replace(/\s/g, "")}): ${list.length} dni wolnych${first ? ` – pierwsze: ${first}` : ""}`;
    }
    case "wikipedia": {
      const first = str(o.streszczenie).split(/(?<=[.!?])\s/)[0];
      return `wikipedia (${str(o.tytul)}): ${first}`;
    }
    case "kalkulator":
      return `kalkulator: ${str(o.dzialanie)} (${Array.isArray(o.liczby) ? o.liczby.map(num).join("; ") : ""}) = ${num(o.wynik)}`;
    case "czas":
    case "aktualnyCzas":
      return `czas (${str(o.strefa)}): ${str(o.data)}, ${str(o.dzienTygodnia)}, ${str(o.godzina)}`;
    case "notatki":
      return o.akcja === "zapisz"
        ? `notatki: zapisano „${str((o.zapisano as Record<string, unknown> | undefined)?.tresc)}” (notatki są tymczasowe)`
        : `notatki: ${Array.isArray(o.notatki) ? o.notatki.length : 0} zapisanych (notatki są tymczasowe)`;
    case "diagnostyka":
      return `diagnostyka: konfiguracja kompletna: ${str(o.konfiguracjaKompletna)}`;
    case "sprawdzObszar":
      return `sprawdzObszar (${str(o.kodPocztowy)}): ${str(o.komunikat)}`;
    case "przestepczosc": {
      const obszar =
        o.obszarDzialaniaAmber === "w_obszarze"
          ? "w obszarze działania firmy"
          : o.obszarDzialaniaAmber === "poza_obszarem"
            ? "prawdopodobnie poza obszarem działania firmy"
            : "obszar działania do potwierdzenia przez zespół";
      return `przestepczosc (${str(o.kodPocztowy)}, ${str(o.miesiacOpis)}): ${num(o.lacznie)} zgłoszeń w promieniu ${str(o.promien)}; ${obszar}`;
    }
    case "informacjeOUrzadzeniu":
      return `informacjeOUrzadzeniu (${str(o.producent)}): ${str(o.komunikat)}`;
    case "generujObraz":
      return "generujObraz: obraz gotowy";
    default:
      return null;
  }
}

export function buildStepLimitSummary(limit: number, results: StepResult[], searched: boolean): string {
  return buildPartialSummary(stepLimitMessage(limit), results, searched);
}

// Wynik częściowy: nagłówek („Zatrzymałem się po N krokach” albo „Przerwałam zadanie po 60 sekundach…”)
// i lista rzeczywistych wyników narzędzi.
export function buildPartialSummary(header: string, results: StepResult[], searched: boolean): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of results) {
    const key = `${r.name}|${JSON.stringify(r.input ?? null)}|${r.kind}`;
    if (seen.has(key)) continue; // to samo narzędzie z tymi samymi danymi – pokazujemy raz
    seen.add(key);
    const line = describeToolResult(r);
    if (line) lines.push(`– ${line}`);
  }
  if (searched) lines.push("– wyszukiwanie: źródła są pod odpowiedzią");
  if (lines.length === 0) {
    return `${header}. Nie udało się jeszcze ustalić wyników – proszę zadać pytanie prościej lub w kilku częściach.`;
  }
  return `${header}. Udało się ustalić:\n${lines.join("\n")}`;
}

export function createAgentHandler(deps: AgentDeps) {
  const log = deps.log ?? ((message: string) => console.log(message));
  const now = deps.now ?? (() => new Date());

  return async function handleAgentRequest(req: Request): Promise<Response> {
    // Warsztat 2 (Standard): czas zadania liczony od przyjęcia zapytania.
    const startedAt = Date.now();
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
    let conversationId: number | null = null;
    if (mode === "chat") {
      // Lekcja 5: numer rozmowy w bazie (brak = nowa rozmowa) – sprawdzany przed wywołaniem modelu.
      const conversation = parseConversationId((body as { conversationId?: unknown }).conversationId);
      if (!conversation.ok) return text(AGENT_MESSAGES.badRequest, 400);
      conversationId = conversation.id;
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
    const models = deps.createModels({ sessionId: sessionId || deps.history.sessionIdFromToken(session.token) });
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

    return streamChat({ req, deps, models, turns, historyKey: historyKey!, sessionId, conversationId, log, now, startedAt });
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
  conversationId,
  log,
  now,
  startedAt,
}: {
  req: Request;
  deps: AgentDeps;
  models: { model: LanguageModel; tools: ToolSet };
  turns: ChatTurn[];
  historyKey: Buffer;
  sessionId: string;
  conversationId: number | null;
  log: (message: string) => void;
  now: () => Date;
  startedAt: number;
}): Response {
  const askedAboutImage = Boolean(turns[turns.length - 1]?.image);
  const budget = createToolBudget();
  const guard = createToolGuard();
  const stepLimit = deps.stepLimit ?? AGENT_STEP_LIMIT;
  const taskTimeoutMs = deps.taskTimeoutMs ?? AGENT_TASK_TIMEOUT_MS;
  const softDeadlineMs = deps.taskSoftDeadlineMs ?? AGENT_TASK_SOFT_DEADLINE_MS;
  const elapsed = () => Date.now() - startedAt;

  // Twardy limit 60 s: własny sygnał (żeby odróżnić przekroczenie czasu od zamknięcia karty przez klienta).
  const taskController = new AbortController();
  const taskTimer = setTimeout(() => taskController.abort(), Math.max(0, taskTimeoutMs - elapsed()));

  const result = streamText({
    model: models.model,
    instructions: deps.instructions.chat,
    messages: toModelMessages(turns),
    tools: withToolBudget(withToolGuards(models.tools, guard, deps.toolTimeoutMs ?? AGENT_TOOL_TIMEOUT_MS), budget),
    stopWhen: isStepCount(stepLimit),
    // Warstwa B: po 14 wywołaniach, po 45 s zadania albo po próbie powtórzenia nieudanego wywołania
    // model ma już odpowiedzieć tekstem (bez kolejnych narzędzi) – z dostępnym wynikiem częściowym.
    prepareStep: () =>
      budget.used >= AGENT_TOOL_SOFT_LIMIT || elapsed() >= softDeadlineMs || guard.blockedRepeats > 0
        ? { toolChoice: "none" as const }
        : {},
    abortSignal: AbortSignal.any([req.signal, taskController.signal]),
    maxRetries: deps.maxRetries,
  });

  const stream = createUIMessageStream<AgentUIMessage>({
    execute: async ({ writer }) => {
      // Dokładnie to, co zapisze przeglądarka – na tej podstawie liczymy podpis.
      // searchSources – ile źródeł pochodzi z wyszukiwania (etykieta „wyszukiwanie”); źródła z Wikipedii jej nie dają.
      type Step = { textOrder: string[]; texts: Map<string, string>; sources: TurnSource[]; toolNames: string[]; searchSources: number };
      const done: Step[] = [];
      const newStep = (): Step => ({ textOrder: [], texts: new Map(), sources: [], toolNames: [], searchSources: 0 });
      let step = newStep();
      const seenUrls = new Set<string>();
      const allowedCalls = new Set<string>();
      const callNames = new Map<string, string>();
      // ReAct: rzeczywiste wyniki narzędzi (do podsumowania po limicie kroków) i numer kroku.
      const callInputs = new Map<string, unknown>();
      const results: StepResult[] = [];
      let stepCount = 0;
      // Lekcja 4: wewnętrzne dane dostawcy (np. reasoning_details – „myślenie” modelu) NIE trafiają do przeglądarki.
      // Serwer ich nie potrzebuje z przeglądarki: pętla kroków działa w streamText (te dane zostają tam),
      // a do modelu w kolejnych wiadomościach wraca wyłącznie podpisany tekst (toModelMessages).
      const send = (chunk: AgentUIChunk) => writer.write(withoutProviderMetadata(chunk));
      // Źródło dodane przez serwer (np. link z Wikipedii) – te same zasady co dla wyszukiwania.
      const addSource = (url: string, rawTitle: string, sourceId: string, fromSearch: boolean): boolean => {
        const all = [...done.flatMap((s) => s.sources), ...step.sources];
        if (!isHttpUrl(url) || seenUrls.has(url) || all.length >= MAX_STREAM_SOURCES) return false;
        seenUrls.add(url);
        const title = rawTitle.trim().slice(0, 200);
        step.sources.push({ url, title });
        if (fromSearch) step.searchSources++;
        writer.write({ type: "source-url", sourceId, url, title });
        return true;
      };
      let hadError = false;
      let finishReason: string | undefined;
      let modelSteps = 0; // Standard: liczba wywołań modelu (rozpoczętych kroków)
      const openTexts = new Set<string>();

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
            openTexts.add(chunk.id);
            send(chunk);
            break;
          case "text-delta":
            step.texts.set(chunk.id, (step.texts.get(chunk.id) ?? "") + chunk.delta);
            send(chunk);
            break;
          case "source-url":
            // Tylko http/https, bez powtórzeń, najwyżej 6 (tak samo sprawdza historia).
            addSource(chunk.url, typeof chunk.title === "string" ? chunk.title : "", chunk.sourceId, true);
            break;
          case "tool-input-start":
          case "tool-input-available":
          case "tool-input-error":
            // Tylko znane narzędzia (inne części byłyby odrzucone przez kontrolę historii).
            if (!(AGENT_TOOL_NAMES as readonly string[]).includes(chunk.toolName) || chunk.dynamic) break;
            // Warstwa A: wywołanie ponad limit – bez części w przeglądarce i bez etykiety (nie zostało wykonane).
            if (!budget.admit(chunk.toolCallId, chunk.toolName)) break;
            if (!allowedCalls.has(chunk.toolCallId)) {
              allowedCalls.add(chunk.toolCallId);
              callNames.set(chunk.toolCallId, chunk.toolName);
              step.toolNames.push(chunk.toolName);
            }
            if (chunk.type === "tool-input-available") callInputs.set(chunk.toolCallId, chunk.input);
            if (chunk.type === "tool-input-error") {
              results.push({ step: stepCount, name: chunk.toolName, input: chunk.input, kind: "inputError" });
            }
            send(chunk);
            break;
          case "tool-output-available":
            if (!allowedCalls.has(chunk.toolCallId)) break;
            send(chunk);
            results.push({
              step: stepCount,
              name: callNames.get(chunk.toolCallId) ?? "",
              input: callInputs.get(chunk.toolCallId),
              kind: "ok",
              output: chunk.output,
            });
            // Wikipedia: link do artykułu jako klikalne źródło pod odpowiedzią (tylko pl.wikipedia.org).
            if (callNames.get(chunk.toolCallId) === "wikipedia") {
              const out = chunk.output as { ok?: unknown; link?: unknown; tytul?: unknown } | null;
              if (out?.ok === true && typeof out.link === "string" && isWikipediaUrl(out.link)) {
                addSource(out.link, `Wikipedia: ${typeof out.tytul === "string" ? out.tytul : "artykuł"}`, `wiki-${chunk.toolCallId}`, false);
              }
            }
            break;
          case "tool-output-error":
            if (!allowedCalls.has(chunk.toolCallId)) break;
            send(chunk);
            results.push({ step: stepCount, name: callNames.get(chunk.toolCallId) ?? "", input: callInputs.get(chunk.toolCallId), kind: "error" });
            break;
          case "tool-input-delta":
          case "tool-output-denied":
            if (allowedCalls.has(chunk.toolCallId)) send(chunk);
            break;
          case "start-step":
            modelSteps++;
            send(chunk);
            break;
          case "text-end":
            openTexts.delete(chunk.id);
            send(chunk);
            break;
          case "start":
          case "finish-step":
            send(chunk);
            break;
          case "abort":
            // Przekroczony limit 60 s: dalej serwer dopisze wynik częściowy (bez znacznika „abort” dla przeglądarki).
            if (!taskController.signal.aborted || req.signal.aborted) send(chunk);
            break;
          case "reset-step":
            step = newStep();
            send(chunk);
            break;
          case "error":
            hadError = true;
            send(chunk);
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
          stepCount++;
        }
      }
      done.push(step);
      clearTimeout(taskTimer);
      // Przekroczony limit 60 s (a nie zamknięcie karty przez klienta).
      const timedOut = taskController.signal.aborted && !req.signal.aborted;

      // Lekcja 4, Warsztat 2 (Fast): przycisk „Stop” w przeglądarce przerywa zapytanie → req.signal przerywa model
      // i narzędzia. Połączenie jest już zamknięte, więc nic więcej nie wysyłamy – tylko wpis w logu serwera.
      if (req.signal.aborted) {
        log(`[Amber] /api/agent – przerwane przez użytkownika (kroki modelu: ${modelSteps}, wywołania narzędzi: ${guard.executed}, czas: ${elapsed()} ms)`);
      }
      // Bez podpisu, gdy odpowiedź jest niepełna (błąd lub przerwanie przez klienta) – takiej odpowiedzi nie da się użyć w historii.
      if ((hadError && !timedOut) || req.signal.aborted) {
        writer.write({ type: "finish", finishReason: "error" });
        return;
      }

      // „tool-calls” na końcu = model chciał dalej używać narzędzi, ale pętla doszła do limitu kroków.
      let finalReason = finishReason;
      if (!timedOut) {
        try {
          finalReason = (await result.finishReason) ?? finalReason;
        } catch {
          // brak informacji – zostaje wartość ze strumienia
        }
      }
      // Tekst przerwany w połowie (limit czasu) – zamykamy go, żeby przeglądarka zapisała go w całości.
      for (const id of openTexts) writer.write({ type: "text-end", id });
      const stepTexts = done.map((s) => s.textOrder.map((id) => s.texts.get(id) ?? "").join(""));
      const modelText = stepTexts.join("");
      const reachedLimit = !timedOut && finalReason === "tool-calls" && stepCount >= stepLimit;
      let replyText = modelText;
      if (timedOut) {
        // Limit 60 s: wynik częściowy wyłącznie z rzeczywistych wyników narzędzi.
        // Tekst przerwanego (nieukończonego) kroku nie opisuje wcześniejszych wyników – liczą się tylko ukończone kroki.
        const lastTextStep = stepTexts.reduce((last, t, i) => (i < stepCount && t.trim() ? i : last), -1);
        const searchedAfter = done.slice(Math.max(lastTextStep, 0)).some((s) => s.searchSources > 0);
        const summary = buildPartialSummary(
          taskTimeoutMessage(taskTimeoutMs),
          results.filter((r) => r.step >= lastTextStep),
          searchedAfter,
        );
        const limitText = (modelText.trim() ? "\n\n" : "") + summary;
        const id = "amber-time-limit";
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: limitText });
        writer.write({ type: "text-end", id });
        replyText = modelText + limitText;
        finalReason = "stop";
        log(`[Amber] /api/agent – ${taskTimeoutMessage(taskTimeoutMs)} (podsumowanie: ${results.length} wyników).`);
      }
      if (reachedLimit) {
        // Wariant B: podsumowanie wyłącznie z rzeczywistych wyników; tylko to, czego model jeszcze nie napisał.
        const lastTextStep = stepTexts.reduce((last, t, i) => (t.trim() ? i : last), -1);
        const searchedAfter = done.slice(Math.max(lastTextStep, 0)).some((s) => s.searchSources > 0);
        const summary = buildStepLimitSummary(stepLimit, results.filter((r) => r.step >= lastTextStep), searchedAfter);
        const limitText = (modelText.trim() ? "\n\n" : "") + summary;
        const id = "amber-step-limit";
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: limitText });
        writer.write({ type: "text-end", id });
        replyText = modelText + limitText;
        log(`[Amber] /api/agent – ${stepLimitMessage(stepLimit)} (podsumowanie: ${results.length} wyników).`);
      }
      const sources = done.flatMap((s) => s.sources);
      const called = new Set(done.flatMap((s) => s.toolNames));
      const searched = done.some((s) => s.searchSources > 0);
      const tools = LABEL_ORDER.filter((name) => (name === "wyszukiwanie" ? searched : called.has(name)));
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
      const stats: AgentStats = { kroki: modelSteps, narzedzia: guard.executed, czasMs: elapsed() };

      // Lekcja 5, Warsztat 2: zapis w bazie – raz, po zakończeniu odpowiedzi (nie każdy kawałek strumienia).
      // Błąd bazy nie psuje odpowiedzi: klient ją dostaje, szczegóły tylko w logu serwera.
      let savedConversationId: number | undefined;
      const store = deps.conversations?.() ?? null;
      if (store) {
        const generatedImage = results.some(
          (r) => r.name === IMAGE_TOOL_NAME && r.kind === "ok" && (r.output as { ok?: unknown } | null)?.ok === true,
        );
        try {
          savedConversationId = await store.saveExchange({ conversationId, turns, replyText, generatedImage });
          log(`[Amber] /api/agent – zapisano w bazie (rozmowa ${savedConversationId}).`);
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          console.error(`[Amber] /api/agent – nie zapisano rozmowy w bazie: ${details.slice(0, 300)}`);
        }
      }

      const metadata: AgentMetadata = {
        kind: "chat",
        sig,
        ...(fetchedAt ? { fetchedAt } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(model ? { model } : {}),
        stats,
        ...(savedConversationId !== undefined ? { conversationId: savedConversationId } : {}),
      };

      if (sources.length > 0) log(`[Amber] /api/agent – źródła (${sources.length}): ${sources.map((s) => s.url).join(" | ")}`);
      if (tools.length > 0) log(`[Amber] /api/agent – użyte narzędzia: ${tools.join(", ")}`);
      if (askedAboutImage) log(`[Amber] /api/agent – zdjęcie przeanalizował model: ${model || "(brak w odpowiedzi API)"}`);
      log(`[Amber] /api/agent – kroki modelu: ${stats.kroki}, wywołania narzędzi: ${stats.narzedzia}, czas: ${stats.czasMs} ms`);

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
