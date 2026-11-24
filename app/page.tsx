import { redirect } from "next/navigation";
import { getCurrentUser } from "../lib/auth";
import { loginUrl } from "../lib/amber-auth-redirect";
import Chat from "./chat";

// Komponent serwerowy: sesję sprawdzamy na serwerze, zanim pokażemy czat. Czyta ciasteczka – zawsze dynamiczny.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Lekcja 7: zalogowana osoba (zweryfikowana sesja Supabase). Bez niej – strona logowania.
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/"));

  return (
    <main className="chat">
      <header className="brand">
        <h1 className="brand-logo">Amber</h1>
        <p className="brand-tagline">Asystent Amber Security Systems Ltd – alarmy, CCTV i ochrona przeciwpożarowa</p>
      </header>
      <Chat email={user.email} name={user.name} avatarUrl={user.avatarUrl} />
    </main>
  );
}
