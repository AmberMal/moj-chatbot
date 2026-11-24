import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import Dashboard from "./dashboard";

// Lekcja 4, Warsztat 3: Dashboard podróży – dostępny tylko po zalogowaniu (sesję sprawdza serwer).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Lekcja 7: zalogowana osoba (zweryfikowana sesja Supabase). Bez niej – strona logowania.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="chat dashboard-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Dashboard podróży</h1>
      <Dashboard />
    </main>
  );
}
