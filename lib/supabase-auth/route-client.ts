// Lekcja 7, Warsztat 3: klient Supabase dla tras logowania (/auth/google, /auth/callback).
// Ciasteczka (kod PKCE, potem sesja) zbieramy i dopisujemy do odpowiedzi z przekierowaniem –
// dokumentacja: odpowiedź musi nieść Set-Cookie, inaczej wymiana kodu na sesję się nie uda.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthConfig } from "./config";

type PendingCookie = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

export function createRouteClient(request: NextRequest) {
  const config = getSupabaseAuthConfig();
  if (!config) return null;
  const pending: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => pending.push({ name, value, options }));
        Object.assign(pendingHeaders, headers ?? {});
      },
    },
  });
  // Przekierowanie z dopisanymi ciasteczkami i nagłówkami „nie zapisuj w pamięci podręcznej”.
  function redirect(url: string) {
    const response = NextResponse.redirect(url);
    pending.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    Object.entries(pendingHeaders).forEach(([key, value]) => response.headers.set(key, value));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return { client, redirect };
}
