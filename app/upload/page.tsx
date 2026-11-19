import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../../lib/auth";
import { KNOWLEDGE_MESSAGES, type DocumentSummary } from "../../lib/amber-knowledge";
import { getKnowledgeStore } from "../../lib/supabase";
import LoginForm from "../login-form";
import UploadForm from "./upload-form";

// Lekcja 6, Warsztat 2: strona do wklejania dokumentów do bazy wiedzy + lista dokumentów (Standard).
// Komponent serwerowy: najpierw sesja, dopiero potem odczyt z bazy (bez sesji – formularz hasła, baza nieużywana).
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  let documents: DocumentSummary[] = [];
  let problem: string | null = null;
  if (loggedIn) {
    const store = getKnowledgeStore();
    if (!store) {
      problem = KNOWLEDGE_MESSAGES.notConfigured;
    } else {
      try {
        documents = await store.listDocuments();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`[Amber] /upload – błąd bazy: ${details.slice(0, 300)}`);
        problem = KNOWLEDGE_MESSAGES.listError;
      }
    }
  }

  return (
    <main className="chat profile-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Baza wiedzy</h1>
      {!loggedIn && <LoginForm configured={config !== null} />}
      {loggedIn && problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {loggedIn && <UploadForm initialDocuments={documents} />}
    </main>
  );
}
