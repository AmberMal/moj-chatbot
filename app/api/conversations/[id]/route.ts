import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../../lib/auth";
import { deriveHistoryKey, sessionIdFromToken, signAgentChatTurn } from "../../../../lib/amber-history";
import { createConversationByIdHandler, createDeleteConversationHandler } from "../../../../lib/amber-conversations";
import { getConversationStore } from "../../../../lib/supabase";

// Lekcja 5, Warsztat 2 (Standard): wybrana rozmowa z bazy (kliknięcie na /history albo adres /?c=12).
// Dla szybkich: DELETE – usunięcie rozmowy.
// 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
// 2. Odpowiedzi Amber dostają podpis dla bieżącej sesji (ta sama funkcja co w /api/agent).
export const dynamic = "force-dynamic";

// Sesja z ciasteczka (wspólna dla GET i DELETE).
function getSession(request: Request) {
  const authConfig = getAuthConfig();
  const token = readCookie(request, SESSION_COOKIE);
  if (!authConfig || !token || !isSessionValid(token, authConfig)) return null;
  return { secret: authConfig.secret, token };
}

const handle = createConversationByIdHandler({
  getSession,
  getStore: getConversationStore,
  sign: (session, history) =>
    signAgentChatTurn(deriveHistoryKey(session.secret), sessionIdFromToken(session.token), history, {}),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id);
}

// Warsztat 2 (Dla szybkich): usunięcie rozmowy (z /history, po potwierdzeniu). Sesja → numer → baza.
// Wiadomości usuwa baza (ON DELETE CASCADE). Ciasteczko sesji ma SameSite=Strict – inna strona nie wyśle tego zapytania z sesją.
const handleDelete = createDeleteConversationHandler({ getSession, getStore: getConversationStore });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDelete(req, (await params).id);
}
