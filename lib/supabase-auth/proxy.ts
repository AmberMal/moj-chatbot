// Lekcja 7: odświeżanie sesji Supabase w proxy.ts (przed każdą stroną i endpointem).
// Proxy to tylko pierwsza linia obrony: przenosi niezalogowanych na /login.
// Tożsamość i tak sprawdza każda strona i każdy endpoint (lib/auth.ts).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthConfig } from "./config";

export const LOGIN_PAGE = "/login";

// Strony dostępne bez logowania. Endpointy (/api) nie są przekierowywane – same zwracają 401.
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PAGE || pathname.startsWith(`${LOGIN_PAGE}/`) || pathname.startsWith("/api/");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseAuthConfig();
  const pathname = request.nextUrl.pathname;

  let loggedIn = false;
  if (config) {
    const supabase = createServerClient(config.url, config.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    });
    // Weryfikacja tokenu (podpis i ważność) – nie samo odczytanie ciasteczka.
    const { data } = await supabase.auth.getClaims();
    loggedIn = Boolean(data?.claims?.sub);
  }

  if (!loggedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PAGE;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Zachowujemy ciasteczka ustawione przy odświeżaniu (np. usunięcie wygasłej sesji).
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  // Ważne: zwracamy obiekt `response` z setAll – inny obiekt wylogowałby użytkownika.
  return response;
}
