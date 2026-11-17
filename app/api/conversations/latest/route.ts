import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../../lib/auth";
import { deriveHistoryKey, sessionIdFromToken, signAgentChatTurn } from "../../../../lib/amber-history";
import { createLatestConversationHandler } from "../../../../lib/amber-conversations";
import { getConversationStore } from "../../../../lib/supabase";

// Lekcja 5, Warsztat 2: ostatnia rozmowa z bazy (po odświeżeniu strony).
// 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
// 2. Odpowiedzi Amber dostają podpis dla bieżącej sesji (ta sama funkcja co w /api/agent).
// Ten plik działa tylko na serwerze – klucz Supabase nie trafia do przeglądarki.
export const dynamic = "force-dynamic";

const handle = createLatestConversationHandler({
  getSession: (request) => {
    const authConfig = getAuthConfig();
    const token = readCookie(request, SESSION_COOKIE);
    if (!authConfig || !token || !isSessionValid(token, authConfig)) return null;
    return { secret: authConfig.secret, token };
  },
  getStore: getConversationStore,
  sign: (session, history) =>
    signAgentChatTurn(deriveHistoryKey(session.secret), sessionIdFromToken(session.token), history, {}),
});

export async function GET(req: Request) {
  return handle(req);
}
