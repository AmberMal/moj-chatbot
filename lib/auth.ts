// Lekcja 7: konta użytkowników przez Supabase Auth (zamiast wspólnego hasła).
// Ten plik działa tylko na serwerze. Tożsamość ustala WYŁĄCZNIE serwer ze zweryfikowanej sesji
// (supabase.auth.getUser() – pyta Supabase o sesję przy każdym zapytaniu). Nigdy z formularza, adresu strony ani od modelu.
import { createSupabaseServerClient } from "./supabase-auth/server";
import { userFromMetadata } from "./amber-user-info";

// Lekcja 7, Warsztat 3: imię i avatar z konta Google (pola sprawdzone w prawdziwych danych użytkownika:
// full_name / name oraz avatar_url / picture). Konto e-mail + hasło ich nie ma → null.
export type CurrentUser = { id: string; email: string; name: string | null; avatarUrl: string | null };

// Lekcja 7 (poprawka po teście bezpieczeństwa, W1 Dla szybkich): getUser() zamiast getClaims().
// getClaims() sprawdza podpis tokenu na miejscu – ciasteczko skradzione przed wylogowaniem działało więc
// do wygaśnięcia tokenu (do 1 h). getUser() pyta Supabase przy każdym zapytaniu, czy sesja nadal istnieje:
// po wylogowaniu stare ciasteczko przestaje działać od razu. proxy.ts zostaje na szybkim getClaims()
// (tylko przekierowania); dostępu do danych pilnują strony i endpointy – przez tę funkcję.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;
    if (error || !user || typeof user.id !== "string" || !user.id) return null;
    return { id: user.id, email: typeof user.email === "string" ? user.email : "", ...userFromMetadata(user.user_metadata) };
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
