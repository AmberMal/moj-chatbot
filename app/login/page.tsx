import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { afterLoginPath, readAuthCallbackError } from "../../lib/amber-auth-redirect";
import { AUTH_MESSAGES } from "../../lib/amber-auth-messages";
import { getSupabaseAuthConfig } from "../../lib/supabase-auth/config";
import AuthForm from "./auth-form";

// Lekcja 7: logowanie i zakładanie konta (Supabase Auth). Strona czyta ciasteczka – zawsze dynamiczna.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; blad?: string | string[] }>;
}) {
  const params = await searchParams;
  // Standard: dokąd wrócić po zalogowaniu (tylko adres wewnątrz aplikacji, inaczej czat).
  const next = afterLoginPath(params.next);
  // Warsztat 3: nieudane albo anulowane logowanie przez Google – komunikat po polsku (tylko znane kody).
  const callbackError = readAuthCallbackError(params.blad);
  const initialError =
    callbackError === "anulowano" ? AUTH_MESSAGES.googleCancelled : callbackError === "google" ? AUTH_MESSAGES.googleFailed : "";
  // Zalogowana osoba nie potrzebuje tej strony – od razu tam, dokąd chciała wejść.
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="chat">
      <header className="brand">
        <h1 className="brand-logo">Amber</h1>
        <p className="brand-tagline">Asystent Amber Security Systems Ltd – alarmy, CCTV i ochrona przeciwpożarowa</p>
      </header>
      <AuthForm configured={getSupabaseAuthConfig() !== null} next={next} initialError={initialError} />
    </main>
  );
}
