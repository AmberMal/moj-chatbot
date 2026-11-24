import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { afterLoginPath } from "../../lib/amber-auth-redirect";
import { getSupabaseAuthConfig } from "../../lib/supabase-auth/config";
import AuthForm from "./auth-form";

// Lekcja 7: logowanie i zakładanie konta (Supabase Auth). Strona czyta ciasteczka – zawsze dynamiczna.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  // Standard: dokąd wrócić po zalogowaniu (tylko adres wewnątrz aplikacji, inaczej czat).
  const next = afterLoginPath((await searchParams).next);
  // Zalogowana osoba nie potrzebuje tej strony – od razu tam, dokąd chciała wejść.
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="chat">
      <header className="brand">
        <h1 className="brand-logo">Amber</h1>
        <p className="brand-tagline">Asystent Amber Security Systems Ltd – alarmy, CCTV i ochrona przeciwpożarowa</p>
      </header>
      <AuthForm configured={getSupabaseAuthConfig() !== null} next={next} />
    </main>
  );
}
