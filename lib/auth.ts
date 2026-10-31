import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Ten plik działa tylko na serwerze.

export const SESSION_COOKIE = "amber_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // sesja wygasa po 8 godzinach

type AuthConfig = { password: string; secret: string };

// Brak hasła albo zbyt krótki sekret = brak konfiguracji = dostęp ZABLOKOWANY.
export function getAuthConfig(): AuthConfig | null {
  const password = process.env.CHAT_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret || secret.length < 32) return null;
  return { password, secret };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

// Porównanie odporne na pomiar czasu odpowiedzi.
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function isPasswordCorrect(input: string, config: AuthConfig): boolean {
  return safeEqual(input, config.password);
}

// Cookie zawiera tylko datę wygaśnięcia, losowy identyfikator i podpis HMAC.
// Hasła NIE ma w cookie.
export function createSessionToken(config: AuthConfig, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload, config.secret)}`;
}

export function isSessionValid(
  token: string | undefined,
  config: AuthConfig | null,
  now = Date.now(),
): boolean {
  if (!token || !config) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  if (!safeEqual(signature, sign(payload, config.secret))) return false;
  const expiresAt = Number(payload.split(".")[0]);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(now / 1000);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
