import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { loginUrl } from "../../lib/amber-auth-redirect";
import { MAX_TRIAGE_EMAILS } from "../../lib/amber-triage";
import TriageForm from "./triage-form";

// Lekcja 8, Warsztat 1: misja „Triage maili” – tylko dla zalogowanych. Czyta ciasteczka – zawsze dynamiczna.
export const dynamic = "force-dynamic";

export default async function EmailTriagePage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/email-triage"));

  return (
    <main className="chat triage-page">
      {/* 27.11: powrót do czatu po prawej (kolumna przycisków), jak na innych stronach */}
      <div className="toolbar">
        <Link href="/" className="logout logout-text">
          ← Wróć do czatu
        </Link>
      </div>
      <h1>Triage maili</h1>
      <p className="hint">
        Wklej maile oddzielone linią z samymi trzema myślnikami (---). Najwyżej {MAX_TRIAGE_EMAILS} maili naraz. Agent
        posortuje je i przygotuje szkice odpowiedzi – niczego nie wysyła.
      </p>
      <TriageForm />
    </main>
  );
}
