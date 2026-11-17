import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../../lib/auth";
import type { Profile } from "../../lib/amber-profile";
import { getProfileStore } from "../../lib/supabase";
import LoginForm from "../login-form";
import ProfileEditor from "./profile-editor";

// Lekcja 5, Warsztat 3 (Standard): profil klienta – podgląd, poprawianie, usuwanie, czyszczenie.
// Komponent serwerowy: najpierw sesja, dopiero potem odczyt z bazy (bez sesji – formularz hasła, baza nieużywana).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  let profile: Profile | null = null;
  let problem: string | null = null;
  if (loggedIn) {
    const store = getProfileStore();
    if (!store) {
      problem = "Baza profilu nie jest skonfigurowana. Uzupełnij dane Supabase w .env.local i uruchom ponownie serwer.";
    } else {
      try {
        profile = await store.load();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`[Amber] /profile – błąd bazy: ${details.slice(0, 300)}`);
        problem = "Nie udało się wczytać profilu. Odśwież stronę za chwilę.";
      }
    }
  }

  return (
    <main className="chat profile-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Profil klienta</h1>
      {!loggedIn && <LoginForm configured={config !== null} />}
      {loggedIn && problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {loggedIn && profile && <ProfileEditor initial={profile} />}
    </main>
  );
}
