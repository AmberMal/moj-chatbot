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

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const MAX_USER_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 100;

// Te same dozwolone wartości co w lib/amber-output.ts (test sprawdza zgodność).
export const HISTORY_CATEGORIES = ["sales", "support", "billing", "unknown"] as const;
export const HISTORY_PRIORITIES = ["normal", "high"] as const;

const KEY_LABEL = "amber-history-v1";
const META_KEYS = ["category", "priority", "needs_review", "sig"] as const;

export type TurnMeta = {
  category: (typeof HISTORY_CATEGORIES)[number];
  priority: (typeof HISTORY_PRIORITIES)[number];
  needs_review: boolean;
};

export type ChatTurn = { role: "user" | "assistant"; text: string };

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

// Jednoznaczne kodowanie: JSON z tablic [rola, tekst] w kolejności rozmowy.
function signaturePayload(sessionId: string, history: ChatTurn[], meta: TurnMeta): string {
  return JSON.stringify({
    v: 1,
    sid: sessionId,
    history: history.map((turn) => [turn.role, turn.text]),
    meta: [meta.category, meta.priority, meta.needs_review],
  });
}

// Podpis odpowiedzi Amber. `history` = cała rozmowa łącznie z tą odpowiedzią (ostatni element).
export function signAssistantTurn(
  key: Buffer,
  sessionId: string,
  history: ChatTurn[],
  meta: TurnMeta,
): string {
  return createHmac("sha256", key)
    .update(signaturePayload(sessionId, history, meta))
    .digest("base64url");
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

function readAssistantMeta(metadata: unknown): (TurnMeta & { sig: string }) | null {
  if (!isPlainObject(metadata)) return null;
  const keys = Object.keys(metadata);
  if (keys.length !== META_KEYS.length) return null;
  if (!keys.every((key) => (META_KEYS as readonly string[]).includes(key))) return null;
  const { category, priority, needs_review, sig } = metadata;
  if (typeof category !== "string" || !(HISTORY_CATEGORIES as readonly string[]).includes(category)) return null;
  if (typeof priority !== "string" || !(HISTORY_PRIORITIES as readonly string[]).includes(priority)) return null;
  if (typeof needs_review !== "boolean") return null;
  if (typeof sig !== "string" || sig.length === 0) return null;
  return { category, priority, needs_review, sig } as TurnMeta & { sig: string };
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

    const text = readTextParts(message.parts);
    if (text === null) return fail(`message-${i}-parts-not-text`, HISTORY_MESSAGES.format);

    if (role === "user") {
      if (text.length > MAX_USER_MESSAGE_CHARS) {
        return fail(`message-${i}-too-long`, HISTORY_MESSAGES.tooLong);
      }
      turns.push({ role, text });
      continue;
    }

    // Odpowiedź Amber: musi mieć poprawny podpis obejmujący całą rozmowę do tego miejsca.
    const meta = readAssistantMeta(message.metadata);
    if (!meta) return fail(`message-${i}-bad-metadata`, HISTORY_MESSAGES.tampered);

    turns.push({ role, text });
    const expected = signAssistantTurn(key, sessionId, turns, meta);
    if (!signatureMatches(expected, meta.sig)) {
      return fail(`message-${i}-bad-signature`, HISTORY_MESSAGES.tampered);
    }
  }

  if (turns[turns.length - 1].role !== "user") {
    return fail("last-message-not-user", HISTORY_MESSAGES.format);
  }

  return { ok: true, turns };
}
