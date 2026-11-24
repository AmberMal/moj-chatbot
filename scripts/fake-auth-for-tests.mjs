// Lekcja 7: atrapa zweryfikowanej sesji dla testów endpointów (bez sieci i bez Supabase).
// W aplikacji sesję weryfikuje Supabase (lib/auth.ts → getClaims). Tu: podpisany „token” z identyfikatorem
// użytkownika – fałszywy albo zmieniony token = brak sesji, tak jak w prawdziwej weryfikacji.
import { createHmac, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { historySessionId } from "../lib/amber-history.ts";

export const SESSION_COOKIE = "sb-test-auth-token";

const sign = (userId, secret) => createHmac("sha256", secret).update(userId).digest("base64url");
const same = (a, b) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// Nowy użytkownik (losowy identyfikator) – jak nowe konto. Drugi argument tylko dla zgodności ze starymi testami.
export function createSessionToken(config) {
  const userId = randomUUID();
  return `${userId}.${sign(userId, config.secret)}`;
}

export function isSessionValid(token, config) {
  if (!token || !config) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  return same(token.slice(dot + 1), sign(token.slice(0, dot), config.secret));
}

export function userIdFromToken(token) {
  const dot = token.lastIndexOf(".");
  return dot > 0 ? token.slice(0, dot) : "";
}

// To samo co w endpointach: identyfikator w podpisie historii = identyfikator użytkownika.
export function sessionIdFromToken(token) {
  return historySessionId(userIdFromToken(token));
}

export function readCookie(req, name) {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
