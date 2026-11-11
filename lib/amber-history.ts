// W3: ochrona historii rozmowy (prompt injection / sfałszowana historia).
// Ten plik działa tylko na serwerze.
//
// 1. Kontrola danych z przeglądarki: tylko role user/assistant, tylko tekst, limity.
// 2. Każda odpowiedź Amber jest podpisana (HMAC-SHA256). Podpis obejmuje:
//    identyfikator sesji, całą rozmowę do tej odpowiedzi włącznie (role, treść, kolejność)
//    oraz metadane odpowiedzi. Zmieniona lub dopisana historia jest odrzucana
//    ZANIM cokolwiek trafi do modelu.
// 3. Klucz do podpisów jest osobny – wyprowadzony z SESSION_SECRET metodą HKDF
//    z etykietą "amber-history-v1" (inny niż klucz ciasteczka sesji).
// 4. Warsztat 3: dwa rodzaje podpisanych odpowiedzi Amber:
//    – odpowiedź JSON z wcześniejszej wersji czatu (przed Warsztatem 3): metadane category/priority/needs_review,
//      podpis v4 – nadal sprawdzany, żeby wcześniej zaczęte rozmowy działały dalej;
//    – odpowiedź czatu z /api/agent (mode=chat): metadane `kind: "chat"`, podpis v5.
//    Rodzaj i wersja są częścią podpisanych danych – podpisu jednego rodzaju nie da się
//    wykorzystać dla drugiego (dopisanie lub usunięcie pól zmienia podpisywane dane).

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const MAX_USER_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 100;

// Te same dozwolone wartości co w lib/amber-output.ts (test sprawdza zgodność).
export const HISTORY_CATEGORIES = ["sales", "support", "billing", "unknown"] as const;
export const HISTORY_PRIORITIES = ["normal", "high"] as const;

const KEY_LABEL = "amber-history-v1";
const META_KEYS = ["category", "priority", "needs_review", "sig"] as const;
// Lekcja 3: opcjonalna data pobrania źródeł (tylko gdy odpowiedź ma źródła).
// Lekcja 3: opcjonalna lista użytych narzędzi (etykiety w czacie).
// `model` = identyfikator modelu z odpowiedzi API (pokazywany pod odpowiedzią o zdjęciu).
const OPTIONAL_META_KEYS = ["fetchedAt", "tools", "model"] as const;

// Lekcja 3 (Vision): zdjęcia od klienta – tylko jpg/png/webp przesłane bezpośrednio (data:),
// najwyżej 1 w wiadomości i tylko w najnowszych wiadomościach klienta (po ostatniej odpowiedzi Amber).
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// Limit długości zakodowanego zdjęcia (~2,2 MB po zdekodowaniu) – mieści się w limicie Vercel 4,5 MB.
export const MAX_IMAGE_DATA_URL_CHARS = 3_000_000;
export const HISTORY_TOOL_NAMES = [
  "wyszukiwanie",
  "aktualnyCzas",
  "sprawdzObszar",
  "informacjeOUrzadzeniu",
  "generujObraz",
] as const;

// Warsztat 3: odpowiedź czatu z /api/agent (mode=chat).
export const AGENT_CHAT_KIND = "chat";
const AGENT_META_KEYS = ["kind", "sig"] as const;
// Części narzędzi w odpowiedzi czatu (np. „tool-generujObraz”) – pokazywane w przeglądarce,
// ale NIGDY nie przekazywane modelowi (model dostaje tylko sprawdzony tekst).
export const AGENT_TOOL_PART_TYPES = [
  "tool-web_search",
  "tool-aktualnyCzas",
  "tool-sprawdzObszar",
  "tool-informacjeOUrzadzeniu",
  "tool-generujObraz",
] as const;
export const MAX_AGENT_TOOL_PARTS = 10;
export const MAX_HISTORY_SOURCES = 6;

// Źródło z wyszukiwania (część „source-url” odpowiedzi Amber).
export type TurnSource = { url: string; title: string };

export type TurnMeta = {
  category: (typeof HISTORY_CATEGORIES)[number];
  priority: (typeof HISTORY_PRIORITIES)[number];
  needs_review: boolean;
};

// `image` (tylko wiadomości klienta) NIE wchodzi do podpisu – podpis obejmuje role i tekst.
export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  image?: { mediaType: string; base64: string };
};

export type HistoryCheck =
  | { ok: true; turns: ChatTurn[] }
  | { ok: false; reason: string; message: string };

// Komunikaty dla użytkownika (po polsku).
export const HISTORY_MESSAGES = {
  format: "Nieprawidłowy format rozmowy. Odśwież stronę (Cmd+R), aby rozpocząć nową rozmowę.",
  tooLong: `Wiadomość jest za długa (maksymalnie ${MAX_USER_MESSAGE_CHARS} znaków). Odśwież stronę (Cmd+R) i wyślij krótszą wiadomość.`,
  tooMany: `Rozmowa jest zbyt długa (maksymalnie ${MAX_HISTORY_MESSAGES} wiadomości). Odśwież stronę (Cmd+R), aby rozpocząć nową rozmowę.`,
  tampered:
    "Historia rozmowy została zmieniona lub wygasła. Odśwież stronę (Cmd+R), aby rozpocząć nową rozmowę.",
} as const;

// ---------------------------------------------------------------------------
// Klucz i podpis
// ---------------------------------------------------------------------------

// Osobny klucz do podpisywania historii, wyprowadzony z SESSION_SECRET (HKDF-SHA256).
export function deriveHistoryKey(sessionSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret, "amber-chatbot", KEY_LABEL, 32));
}

// Identyfikator sesji = podpisana część ciasteczka (data wygaśnięcia + losowy identyfikator).
// Wywoływać tylko dla ciasteczka już sprawdzonego przez isSessionValid.
export function sessionIdFromToken(token: string): string {
  const lastDot = token.lastIndexOf(".");
  return lastDot > 0 ? token.slice(0, lastDot) : "";
}

// Jednoznaczne kodowanie: JSON z tablic [rola, tekst] w kolejności rozmowy,
// źródeł tej odpowiedzi [adres, tytuł] i metadanych.
// v2 = lekcja 3 (źródła + data pobrania), v3 = lista użytych narzędzi, v4 = identyfikator modelu.
function signaturePayload(
  sessionId: string,
  history: ChatTurn[],
  meta: TurnMeta,
  sources: TurnSource[],
  fetchedAt: string,
  tools: string[],
  model: string,
): string {
  return JSON.stringify({
    v: 4,
    sid: sessionId,
    history: history.map((turn) => [turn.role, turn.text]),
    sources: sources.map((source) => [source.url, source.title]),
    tools,
    model,
    meta: [meta.category, meta.priority, meta.needs_review, fetchedAt],
  });
}

// Podpis odpowiedzi Amber. `history` = cała rozmowa łącznie z tą odpowiedzią (ostatni element).
export function signAssistantTurn(
  key: Buffer,
  sessionId: string,
  history: ChatTurn[],
  meta: TurnMeta,
  sources: TurnSource[] = [],
  fetchedAt = "",
  tools: string[] = [],
  model = "",
): string {
  return createHmac("sha256", key)
    .update(signaturePayload(sessionId, history, meta, sources, fetchedAt, tools, model))
    .digest("base64url");
}

// Warsztat 3: podpis odpowiedzi czatu z /api/agent (mode=chat). Osobna wersja (v5) i rodzaj ("chat").
export type AgentTurnInfo = { sources?: TurnSource[]; fetchedAt?: string; tools?: string[]; model?: string };

function agentSignaturePayload(sessionId: string, history: ChatTurn[], info: AgentTurnInfo): string {
  return JSON.stringify({
    v: 5,
    kind: AGENT_CHAT_KIND,
    sid: sessionId,
    history: history.map((turn) => [turn.role, turn.text]),
    sources: (info.sources ?? []).map((source) => [source.url, source.title]),
    tools: info.tools ?? [],
    model: info.model ?? "",
    fetchedAt: info.fetchedAt ?? "",
  });
}

export function signAgentChatTurn(
  key: Buffer,
  sessionId: string,
  history: ChatTurn[],
  info: AgentTurnInfo = {},
): string {
  return createHmac("sha256", key).update(agentSignaturePayload(sessionId, history, info)).digest("base64url");
}

function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Kontrola historii z przeglądarki
// ---------------------------------------------------------------------------

function fail(reason: string, message: string): HistoryCheck {
  return { ok: false, reason, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextParts(parts: unknown): string | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let text = "";
  for (const part of parts) {
    if (!isPlainObject(part) || part.type !== "text" || typeof part.text !== "string") return null;
    text += part.text;
  }
  return text;
}

// Wiadomość klienta: części tekstowe + najwyżej jedno zdjęcie (jpg/png/webp jako data:).
function readUserParts(
  parts: unknown,
): { text: string; image?: { mediaType: string; base64: string } } | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let text = "";
  let image: { mediaType: string; base64: string } | undefined;
  for (const part of parts) {
    if (!isPlainObject(part)) return null;
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
      continue;
    }
    if (part.type !== "file" || image) return null;
    const { mediaType, url } = part;
    if (typeof mediaType !== "string" || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mediaType)) return null;
    if (typeof url !== "string" || url.length > MAX_IMAGE_DATA_URL_CHARS) return null;
    const prefix = `data:${mediaType};base64,`;
    if (!url.startsWith(prefix)) return null;
    const base64 = url.slice(prefix.length);
    if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    image = { mediaType, base64 };
  }
  return image ? { text, image } : { text };
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

// Odpowiedź Amber: części tekstowe + opcjonalne części „source-url” (adres http/https).
// Warsztat 3 (tylko odpowiedź czatu z /api/agent): także „step-start” i części znanych narzędzi.
// Części narzędzi są tylko sprawdzane (typ, identyfikator) i pomijane – nie trafiają do modelu ani do podpisu.
function readAssistantParts(
  parts: unknown,
  agentChat = false,
): { text: string; sources: TurnSource[] } | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let text = "";
  let hasText = false;
  let toolParts = 0;
  const sources: TurnSource[] = [];
  for (const part of parts) {
    if (!isPlainObject(part)) return null;
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
      hasText = true;
    } else if (part.type === "source-url" && isHttpUrl(part.url)) {
      const title = part.title === undefined ? "" : part.title;
      if (typeof title !== "string") return null;
      sources.push({ url: part.url, title });
    } else if (agentChat && part.type === "step-start") {
      continue;
    } else if (
      agentChat &&
      typeof part.type === "string" &&
      (AGENT_TOOL_PART_TYPES as readonly string[]).includes(part.type) &&
      typeof part.toolCallId === "string" &&
      part.toolCallId.length > 0 &&
      part.toolCallId.length <= 200
    ) {
      toolParts++;
    } else {
      return null;
    }
  }
  if (sources.length > MAX_HISTORY_SOURCES || toolParts > MAX_AGENT_TOOL_PARTS) return null;
  // Odpowiedź JSON zawsze ma tekst; odpowiedź czatu może składać się z samego narzędzia (np. obrazu).
  if (!hasText && !(agentChat && toolParts > 0)) return null;
  return { text, sources };
}

// Wspólna kontrola opcjonalnych metadanych (źródła, narzędzia, model).
function readOptionalMeta(metadata: Record<string, unknown>) {
  const { fetchedAt = "", tools = [], model = "" } = metadata;
  if (typeof fetchedAt !== "string" || fetchedAt.length > 40) return null;
  if (typeof model !== "string" || model.length > 120) return null;
  if (
    !Array.isArray(tools) ||
    tools.length > HISTORY_TOOL_NAMES.length ||
    new Set(tools).size !== tools.length ||
    !tools.every((name) => (HISTORY_TOOL_NAMES as readonly unknown[]).includes(name))
  ) {
    return null;
  }
  return { fetchedAt, tools: tools as string[], model };
}

// Metadane odpowiedzi czatu z /api/agent: dokładnie kind = "chat" + sig (+ opcjonalne pola).
function readAgentMeta(
  metadata: unknown,
): { sig: string; fetchedAt: string; tools: string[]; model: string } | null {
  if (!isPlainObject(metadata) || metadata.kind !== AGENT_CHAT_KIND) return null;
  const keys = Object.keys(metadata);
  const allowed = [...AGENT_META_KEYS, ...OPTIONAL_META_KEYS] as readonly string[];
  if (!keys.every((key) => allowed.includes(key))) return null;
  const { sig } = metadata;
  if (typeof sig !== "string" || sig.length === 0) return null;
  const optional = readOptionalMeta(metadata);
  return optional ? { sig, ...optional } : null;
}

function readAssistantMeta(
  metadata: unknown,
): (TurnMeta & { sig: string; fetchedAt: string; tools: string[]; model: string }) | null {
  if (!isPlainObject(metadata)) return null;
  const keys = Object.keys(metadata);
  const allowed = [...META_KEYS, ...OPTIONAL_META_KEYS] as readonly string[];
  if (!keys.every((key) => allowed.includes(key))) return null;
  if (!META_KEYS.every((key) => keys.includes(key))) return null;
  const { category, priority, needs_review, sig, fetchedAt = "", tools = [], model = "" } = metadata;
  if (typeof fetchedAt !== "string" || fetchedAt.length > 40) return null;
  if (typeof model !== "string" || model.length > 120) return null;
  if (
    !Array.isArray(tools) ||
    tools.length > HISTORY_TOOL_NAMES.length ||
    new Set(tools).size !== tools.length ||
    !tools.every((name) => (HISTORY_TOOL_NAMES as readonly unknown[]).includes(name))
  ) {
    return null;
  }
  if (typeof category !== "string" || !(HISTORY_CATEGORIES as readonly string[]).includes(category)) return null;
  if (typeof priority !== "string" || !(HISTORY_PRIORITIES as readonly string[]).includes(priority)) return null;
  if (typeof needs_review !== "boolean") return null;
  if (typeof sig !== "string" || sig.length === 0) return null;
  return { category, priority, needs_review, sig, fetchedAt, tools, model } as TurnMeta & {
    sig: string;
    fetchedAt: string;
    tools: string[];
    model: string;
  };
}

// Sprawdza całą historię. Zwraca wyłącznie czysty tekst (role + treść) do przekazania modelowi.
export function checkChatHistory(
  messages: unknown,
  { key, sessionId }: { key: Buffer; sessionId: string },
): HistoryCheck {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail("not-array-or-empty", HISTORY_MESSAGES.format);
  }
  if (messages.length > MAX_HISTORY_MESSAGES) {
    return fail("too-many-messages", HISTORY_MESSAGES.tooMany);
  }
  if (!sessionId) return fail("no-session-id", HISTORY_MESSAGES.tampered);

  const turns: ChatTurn[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!isPlainObject(message)) return fail(`message-${i}-not-object`, HISTORY_MESSAGES.format);

    const role = message.role;
    if (role !== "user" && role !== "assistant") {
      return fail(`message-${i}-role-${String(role)}`, HISTORY_MESSAGES.format);
    }

    if (role === "user") {
      const user = readUserParts(message.parts);
      if (user === null) return fail(`message-${i}-parts-not-text`, HISTORY_MESSAGES.format);
      if (user.text.length > MAX_USER_MESSAGE_CHARS) {
        return fail(`message-${i}-too-long`, HISTORY_MESSAGES.tooLong);
      }
      turns.push(user.image ? { role, text: user.text, image: user.image } : { role, text: user.text });
      continue;
    }

    // Warsztat 3: odpowiedź czatu z /api/agent (kind = "chat", podpis v5).
    if (isPlainObject(message.metadata) && "kind" in message.metadata) {
      const agentMeta = readAgentMeta(message.metadata);
      if (!agentMeta) return fail(`message-${i}-bad-metadata`, HISTORY_MESSAGES.tampered);
      const agentParts = readAssistantParts(message.parts, true);
      if (agentParts === null) return fail(`message-${i}-parts-not-text`, HISTORY_MESSAGES.format);
      turns.push({ role, text: agentParts.text });
      const expectedAgent = signAgentChatTurn(key, sessionId, turns, {
        sources: agentParts.sources,
        fetchedAt: agentMeta.fetchedAt,
        tools: agentMeta.tools,
        model: agentMeta.model,
      });
      if (!signatureMatches(expectedAgent, agentMeta.sig)) {
        return fail(`message-${i}-bad-signature`, HISTORY_MESSAGES.tampered);
      }
      continue;
    }

    // Odpowiedź Amber (JSON): tekst (+ ewentualne źródła) i poprawny podpis obejmujący całą rozmowę.
    const assistant = readAssistantParts(message.parts);
    if (assistant === null) return fail(`message-${i}-parts-not-text`, HISTORY_MESSAGES.format);

    const meta = readAssistantMeta(message.metadata);
    if (!meta) return fail(`message-${i}-bad-metadata`, HISTORY_MESSAGES.tampered);

    turns.push({ role, text: assistant.text });
    const expected = signAssistantTurn(
      key,
      sessionId,
      turns,
      meta,
      assistant.sources,
      meta.fetchedAt,
      meta.tools,
      meta.model,
    );
    if (!signatureMatches(expected, meta.sig)) {
      return fail(`message-${i}-bad-signature`, HISTORY_MESSAGES.tampered);
    }
  }

  if (turns[turns.length - 1].role !== "user") {
    return fail("last-message-not-user", HISTORY_MESSAGES.format);
  }

  // Zdjęcia tylko w najnowszych wiadomościach klienta (po ostatniej odpowiedzi Amber).
  const lastAssistant = turns.map((turn) => turn.role).lastIndexOf("assistant");
  if (turns.some((turn, index) => turn.image && index < lastAssistant)) {
    return fail("old-message-with-image", HISTORY_MESSAGES.format);
  }

  return { ok: true, turns };
}
