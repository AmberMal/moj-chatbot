// Lekcja 7 (Standard): powrót po zalogowaniu na stronę, na którą ktoś chciał wejść.
// Tylko adresy wewnątrz aplikacji – inaczej ktoś mógłby podesłać link „zaloguj się i przejdź na obcą stronę”.
export const LOGIN_PATH = "/login";
const BASE = "http://amber.local";

// Zwraca bezpieczny adres wewnętrzny (ścieżka + parametry) albo null.
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 512) return null;
  // Tylko „/coś”: bez „//obca.strona”, bez „\”, bez znaków sterujących, bez „https://…”.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = url.pathname;
  // Nie wracamy na stronę logowania ani do endpointów i plików technicznych.
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`) || path.startsWith("/api/") || path.startsWith("/_next/")) return null;
  return `${path}${url.search}${url.hash}`;
}

// Adres strony logowania z zapamiętanym celem (strona główna nie potrzebuje parametru).
export function loginUrl(next?: string | null): string {
  const safe = safeNextPath(next);
  return safe && safe !== "/" ? `${LOGIN_PATH}?next=${encodeURIComponent(safe)}` : LOGIN_PATH;
}

// Cel po zalogowaniu: bezpieczny adres z parametru next albo czat.
export function afterLoginPath(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return safeNextPath(value) ?? "/";
}

// Lekcja 7, Warsztat 3: adres, pod którym aplikacja właśnie działa (bez localhost na sztywno) –
// tak jak w dokumentacji Supabase: lokalnie adres zapytania, za pośrednikiem (np. Vercel) nagłówek x-forwarded-host.
export function appOrigin(requestUrl: string, headers: Headers, isDev = process.env.NODE_ENV === "development"): string {
  const origin = new URL(requestUrl).origin;
  if (isDev) return origin;
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  // Tylko sama nazwa hosta (opcjonalnie z portem) – bez ścieżek i innych znaków.
  return forwarded && /^[a-z0-9.-]+(:\d+)?$/i.test(forwarded) ? `https://${forwarded}` : origin;
}

// Kod błędu do strony logowania (/login?blad=…) – tylko znane wartości.
export const AUTH_CALLBACK_ERRORS = ["google", "anulowano"] as const;
export type AuthCallbackError = (typeof AUTH_CALLBACK_ERRORS)[number];
export function readAuthCallbackError(raw: unknown): AuthCallbackError | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (AUTH_CALLBACK_ERRORS as readonly string[]).includes(value as string) ? (value as AuthCallbackError) : null;
}
