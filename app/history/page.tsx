import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { loginUrl } from "../../lib/amber-auth-redirect";
import {
  HISTORY_EMPTY_MESSAGE,
  deleteConfirmMessage,
  formatConversationDate,
  formatMessageCount,
  type ConversationSummary,
} from "../../lib/amber-conversations";
import { getUserConversationStore } from "../../lib/supabase";
import DeleteConversationButton from "./delete-button";

// Lekcja 5, Warsztat 2 (Standard): lista zapisanych rozmów – jak pasek boczny w ChatGPT.
// Komponent serwerowy: najpierw sesja, dopiero potem odczyt z bazy (bez sesji – przekierowanie na /login, baza nieużywana).
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  // Lekcja 7: zalogowana osoba (zweryfikowana sesja Supabase). Bez niej – strona logowania.
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/history"));

  let conversations: ConversationSummary[] = [];
  let problem: string | null = null;
  const store = await getUserConversationStore();
  if (!store) {
    problem = "Baza rozmów nie jest skonfigurowana. Uzupełnij dane Supabase w .env.local i uruchom ponownie serwer.";
  } else {
    try {
      conversations = await store.list();
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.error(`[Amber] /history – błąd bazy: ${details.slice(0, 300)}`);
      problem = "Nie udało się wczytać listy rozmów. Odśwież stronę za chwilę.";
    }
  }

  return (
    <main className="chat history-page">
      {/* 27.11: powrót do czatu po prawej (kolumna przycisków) */}
      <div className="toolbar">
        <Link href="/" className="logout logout-text">
          ← Wróć do czatu
        </Link>
      </div>
      <h1>Historia rozmów</h1>
      <>
          {/* 27.11: „Nowa rozmowa” pod tytułem, w kolorze logo Amber */}
          <Link href="/?new=1" className="logout logout-new history-new">
            Nowa rozmowa
          </Link>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
          {/* Dla szybkich: pusta lista – zachęta do pierwszej rozmowy głosem Amber */}
          {!problem && conversations.length === 0 && (
            <div className="history-empty">
              <p>{HISTORY_EMPTY_MESSAGE}</p>
              <Link href="/?new=1" className="logout">
                Zacznij rozmowę
              </Link>
            </div>
          )}
          {conversations.length > 0 && (
            <ul className="history-list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link href={`/?c=${conversation.id}`} className="history-item">
                    <span className="history-title">{conversation.title}</span>
                    <span className="history-meta">
                      {formatConversationDate(conversation.createdAt)} · {formatMessageCount(conversation.messageCount)}
                    </span>
                  </Link>
                  {/* Dla szybkich: usunięcie rozmowy (z potwierdzeniem) */}
                  <DeleteConversationButton
                    id={conversation.id}
                    title={conversation.title}
                    confirmMessage={deleteConfirmMessage(conversation.title)}
                  />
                </li>
              ))}
            </ul>
          )}
      </>
    </main>
  );
}
