// Lekcja 7: konta użytkowników przez Supabase Auth (zamiast wspólnego hasła).
// Ten plik działa tylko na serwerze. Tożsamość ustala WYŁĄCZNIE serwer ze zweryfikowanej sesji
// (supabase.auth.getClaims() – sprawdza podpis i ważność tokenu). Nigdy z formularza, adresu strony ani od modelu.
import { createSupabaseServerClient } from "./supabase-auth/server";

export type CurrentUser = { id: string; email: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims || typeof claims.sub !== "string" || !claims.sub) return null;
    return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`[Amber] Sprawdzanie sesji Supabase nie powiodło się: ${details.slice(0, 200)}`);
    return null;
  }
}

// Sekret do podpisów historii rozmowy (HMAC; klucz wyprowadzany przez HKDF w lib/amber-history.ts).
// Od lekcji 7: SUPABASE_SECRET_KEY (tylko serwer) – dawny osobny sekret sesji nie jest już potrzebny.
export function getHistorySecret(): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY;
  return secret && secret.length >= 32 ? secret : null;
}

// Dla endpointów: null = brak zalogowanej osoby (albo brak konfiguracji) → endpoint zwraca 401.
// token = identyfikator użytkownika (ze zweryfikowanej sesji).
export async function getApiSession(): Promise<{ secret: string; token: string; email: string } | null> {
  const user = await getCurrentUser();
  const secret = getHistorySecret();
  if (!user || !secret) return null;
  return { secret, token: user.id, email: user.email };
}
