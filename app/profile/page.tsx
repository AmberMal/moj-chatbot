import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { loginUrl } from "../../lib/amber-auth-redirect";
import { greetingText, type Profile } from "../../lib/amber-profile";
import { getUserProfileStore } from "../../lib/supabase";
import ProfileEditor from "./profile-editor";

// Lekcja 5, Warsztat 3 (Standard): profil klienta – podgląd, poprawianie, usuwanie, czyszczenie.
// Komponent serwerowy: najpierw sesja, dopiero potem odczyt z bazy (bez sesji – przekierowanie na /login, baza nieużywana).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  // Lekcja 7: zalogowana osoba (zweryfikowana sesja Supabase). Bez niej – strona logowania.
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/profile"));

  let profile: Profile | null = null;
  let problem: string | null = null;
  const store = await getUserProfileStore();
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

  return (
    <main className="chat profile-page">
      {/* 27.11: powrót do czatu po prawej (kolumna przycisków), jak w Historii */}
      <div className="toolbar">
        <Link href="/" className="logout logout-text">
          ← Wróć do czatu
        </Link>
      </div>
      <h1>Profil klienta</h1>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {profile && <ProfileEditor initial={profile} initialGreeting={greetingText(profile)} />}
    </main>
  );
}
