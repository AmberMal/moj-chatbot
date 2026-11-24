import { getApiSession } from "../../../../lib/auth";
import { deriveHistoryKey, historySessionId, signAgentChatTurn } from "../../../../lib/amber-history";
import { createLatestConversationHandler } from "../../../../lib/amber-conversations";
import { getConversationStore } from "../../../../lib/supabase";

// Lekcja 5, Warsztat 2: ostatnia rozmowa z bazy (po odświeżeniu strony).
// 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
// 2. Odpowiedzi Amber dostają podpis dla bieżącej sesji (ta sama funkcja co w /api/agent).
// Ten plik działa tylko na serwerze – klucz Supabase nie trafia do przeglądarki.
export const dynamic = "force-dynamic";

const handle = createLatestConversationHandler({
  // Zalogowana osoba (zweryfikowana sesja Supabase) – bez niej 401.
  getSession: () => getApiSession(),
  getStore: getConversationStore,
  sign: (session, history) =>
    signAgentChatTurn(deriveHistoryKey(session.secret), historySessionId(session.token), history, {}),
});

export async function GET(req: Request) {
  return handle(req);
}
