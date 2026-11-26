import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { loginUrl } from "../../lib/amber-auth-redirect";
import { publicMissions } from "../../lib/amber-missions";
import MissionsForm from "./missions-form";

// Lekcja 8, Warsztat 2: lista misji – tylko dla zalogowanych. Czyta ciasteczka – zawsze dynamiczna.
export const dynamic = "force-dynamic";

export default async function MissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/misje"));

  return (
    <main className="chat triage-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Misje</h1>
      <p className="hint">Wybierz misję, uzupełnij pola i uruchom agenta. Misja może trwać do minuty – agent niczego nie zapisuje ani nie wysyła.</p>
      <MissionsForm missions={publicMissions()} />
    </main>
  );
}
