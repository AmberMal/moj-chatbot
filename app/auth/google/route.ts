import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { afterLoginPath, appOrigin } from "../../../lib/amber-auth-redirect";
import { createRouteClient } from "../../../lib/supabase-auth/route-client";

// Lekcja 7, Warsztat 3: start logowania przez Google (przepływ PKCE po stronie serwera, @supabase/ssr).
// Client ID i Client Secret są tylko w panelu Supabase – nie w kodzie.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = appOrigin(request.url, request.headers);
  // Dokąd wrócić po zalogowaniu – tylko ścieżka wewnątrz aplikacji, inaczej czat.
  const next = afterLoginPath(request.nextUrl.searchParams.get("next"));
  const route = createRouteClient(request);
  if (!route) return NextResponse.redirect(`${origin}/login?blad=google`);

  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { data, error } = await route.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (error || !data?.url) {
    console.error(`[Amber] /auth/google – start logowania nieudany: ${error?.message ?? "brak adresu"}`.slice(0, 300));
    return route.redirect(`${origin}/login?blad=google`);
  }
  // Przeglądarka idzie do Google; ciasteczko z kodem PKCE jedzie razem z tym przekierowaniem.
  return route.redirect(data.url);
}
