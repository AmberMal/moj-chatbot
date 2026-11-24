import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { afterLoginPath, appOrigin } from "../../../lib/amber-auth-redirect";
import { createRouteClient } from "../../../lib/supabase-auth/route-client";

// Lekcja 7, Warsztat 3: powrót od Google (przez Supabase). Wymiana kodu na sesję, potem czat
// (albo strona, na którą ktoś chciał wejść – tylko adres wewnątrz aplikacji).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = appOrigin(request.url, request.headers);
  const next = afterLoginPath(params.get("next"));

  // Anulowanie na ekranie zgody Google albo inny błąd dostawcy → /login z komunikatem po polsku.
  const providerError = params.get("error");
  if (providerError) {
    const cancelled = providerError === "access_denied";
    console.warn(`[Amber] /auth/callback – ${cancelled ? "logowanie anulowane" : `błąd dostawcy: ${providerError}`.slice(0, 120)}`);
    return NextResponse.redirect(`${origin}/login?blad=${cancelled ? "anulowano" : "google"}`);
  }

  const code = params.get("code");
  const route = createRouteClient(request);
  if (!code || !route) return NextResponse.redirect(`${origin}/login?blad=google`);

  const { error } = await route.client.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`[Amber] /auth/callback – wymiana kodu nieudana: ${error.message}`.slice(0, 300));
    return route.redirect(`${origin}/login?blad=google`);
  }
  return route.redirect(`${origin}${next}`);
}
