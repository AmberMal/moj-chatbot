import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../../lib/auth";
import { deriveHistoryKey, sessionIdFromToken, signAgentChatTurn } from "../../../../lib/amber-history";
import { createConversationByIdHandler } from "../../../../lib/amber-conversations";
import { getConversationStore } from "../../../../lib/supabase";

// Lekcja 5, Warsztat 2 (Standard): wybrana rozmowa z bazy (kliknięcie na /history albo adres /?c=12).
// 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
// 2. Odpowiedzi Amber dostają podpis dla bieżącej sesji (ta sama funkcja co w /api/agent).
export const dynamic = "force-dynamic";

const handle = createConversationByIdHandler({
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id);
}
