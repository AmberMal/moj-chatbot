import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../../lib/auth";
import LoginForm from "../login-form";
import Dashboard from "./dashboard";

// Lekcja 4, Warsztat 3: Dashboard podróży – dostępny tylko po zalogowaniu (sesję sprawdza serwer).
export default async function DashboardPage() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  return (
    <main className="chat dashboard-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Dashboard podróży</h1>
      {loggedIn ? <Dashboard /> : <LoginForm configured={config !== null} />}
    </main>
  );
}
