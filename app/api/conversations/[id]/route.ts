import { getApiSession } from "../../../../lib/auth";
import { deriveHistoryKey, historySessionId, signAgentChatTurn } from "../../../../lib/amber-history";
import { createConversationByIdHandler, createDeleteConversationHandler } from "../../../../lib/amber-conversations";
import { getUserConversationStore } from "../../../../lib/supabase";

// Lekcja 5, Warsztat 2 (Standard): wybrana rozmowa z bazy (kliknięcie na /history albo adres /?c=12).
// Dla szybkich: DELETE – usunięcie rozmowy.
// 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
// 2. Odpowiedzi Amber dostają podpis dla bieżącej sesji (ta sama funkcja co w /api/agent).
export const dynamic = "force-dynamic";

// Zalogowana osoba (zweryfikowana sesja Supabase) – wspólna dla GET i DELETE.
function getSession() {
  return getApiSession();
}

const handle = createConversationByIdHandler({
  getSession,
  getStore: getUserConversationStore,
  sign: (session, history) =>
    signAgentChatTurn(deriveHistoryKey(session.secret), historySessionId(session.token), history, {}),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id);
}

// Warsztat 2 (Dla szybkich): usunięcie rozmowy (z /history, po potwierdzeniu). Sesja → numer → baza.
// Wiadomości usuwa baza (ON DELETE CASCADE). Ciasteczka sesji Supabase mają SameSite=Lax – inna strona nie wyśle zapytania DELETE z sesją.
const handleDelete = createDeleteConversationHandler({ getSession, getStore: getUserConversationStore });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDelete(req, (await params).id);
}
