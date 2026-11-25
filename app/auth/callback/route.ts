import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { afterLoginPath, appOrigin } from "../../../lib/amber-auth-redirect";
import { createRouteClient } from "../../../lib/supabase-auth/route-client";
import { createUserStores } from "../../../lib/supabase";
import { userFromMetadata } from "../../../lib/amber-user-info";
import { checkProfileInput } from "../../../lib/amber-profile";

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

  // Warsztat 3 (Standard): profil bez imienia → zapisujemy imię z konta Google (agent wita po imieniu
  // już w pierwszej rozmowie). Dane konta z getUser() (pyta Supabase), zapis klientem tej osoby (RLS),
  // ta sama kontrola co w narzędziu zapiszProfil. Istniejącego imienia nie nadpisujemy. Błąd nie blokuje logowania.
  try {
    const { data } = await route.client.auth.getUser();
    const googleName = userFromMetadata(data.user?.user_metadata).name;
    const profile = createUserStores(route.client).profile;
    if (googleName && profile && !(await profile.load()).name) {
      const check = checkProfileInput({ imie: googleName });
      if (check.ok) await profile.save(check.value);
    }
  } catch (profileError) {
    const details = profileError instanceof Error ? profileError.message : String(profileError);
    console.error(`[Amber] /auth/callback – imię z Google nie zapisane w profilu: ${details.slice(0, 200)}`);
  }
  return route.redirect(`${origin}${next}`);
}
