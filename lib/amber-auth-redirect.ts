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
