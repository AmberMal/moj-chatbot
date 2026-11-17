import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../../lib/auth";
import {
  formatConversationDate,
  formatMessageCount,
  type ConversationSummary,
} from "../../lib/amber-conversations";
import { getConversationStore } from "../../lib/supabase";
import LoginForm from "../login-form";

// Lekcja 5, Warsztat 2 (Standard): lista zapisanych rozmów – jak pasek boczny w ChatGPT.
// Komponent serwerowy: najpierw sesja, dopiero potem odczyt z bazy (bez sesji – formularz hasła, baza nieużywana).
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  let conversations: ConversationSummary[] = [];
  let problem: string | null = null;
  if (loggedIn) {
    const store = getConversationStore();
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
  }

  return (
    <main className="chat history-page">
      <div className="page-nav">
        <Link href="/">← Wróć do czatu</Link>
      </div>
      <h1>Historia rozmów</h1>
      {loggedIn ? (
        <>
          <div className="toolbar">
            <Link href="/?new=1" className="logout">
              Nowa rozmowa
            </Link>
          </div>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
          {!problem && conversations.length === 0 && <p className="hint">Nie ma jeszcze zapisanych rozmów.</p>}
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
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <LoginForm configured={config !== null} />
      )}
    </main>
  );
}
