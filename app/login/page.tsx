import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { getSupabaseAuthConfig } from "../../lib/supabase-auth/config";
import AuthForm from "./auth-form";

// Lekcja 7: logowanie i zakładanie konta (Supabase Auth). Strona czyta ciasteczka – zawsze dynamiczna.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Zalogowana osoba nie potrzebuje tej strony – od razu czat.
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="chat">
      <header className="brand">
        <h1 className="brand-logo">Amber</h1>
        <p className="brand-tagline">Asystent Amber Security Systems Ltd – alarmy, CCTV i ochrona przeciwpożarowa</p>
      </header>
      <AuthForm configured={getSupabaseAuthConfig() !== null} />
    </main>
  );
}
