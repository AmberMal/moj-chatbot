import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../../lib/auth";
import LoginForm from "../login-form";
import UploadForm from "./upload-form";

// Lekcja 6, Warsztat 2 (Minimum, krok A): strona do wklejania dokumentów do bazy wiedzy.
// Bez sesji – formularz hasła (baza nieużywana).
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  return (
    <main className="chat profile-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Baza wiedzy</h1>
      {!loggedIn && <LoginForm configured={config !== null} />}
      {loggedIn && <UploadForm />}
    </main>
  );
}
