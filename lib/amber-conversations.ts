// Lekcja 5, Warsztat 2 (Minimum): trwałe rozmowy w Supabase.
//   conversations (id, created_at, title) – jedna rozmowa;
//   messages (id, created_at, conversation_id → conversations.id, role, content) – wiadomości w kolejności id.
//
// Zasady:
// – zapis po zakończeniu odpowiedzi Amber: wiadomości klienta, które jeszcze nie mają odpowiedzi
//   (np. pytanie przerwane przyciskiem Stop) + odpowiedź Amber – jednym poleceniem, raz, w dobrej kolejności;
// – w bazie tylko tekst: zdjęcie klienta i wygenerowany obraz → dopisek „[obraz]”;
// – odczyt ostatniej rozmowy: odpowiedzi Amber są podpisywane NA NOWO dla bieżącej sesji (ta sama funkcja
//   signAgentChatTurn i ta sama kontrola historii co dotąd). Bazie można ufać – zapisuje do niej tylko serwer
//   kluczem secret; RLS bez polityk blokuje dostęp z zewnątrz.
//
// Ten plik działa tylko na serwerze. Baza i podpisy są przekazywane z zewnątrz (testy bez Supabase:
// scripts/test-amber-persistence.mjs). Importy tylko typów – pliki lib/ nie importują się w czasie działania.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import type { ChatTurn } from "./amber-history";

export const IMAGE_NOTE = "[obraz]";
export const CONVERSATION_TITLE_CHARS = 60;
// Najwyżej tyle wiadomości wraca do czatu po odświeżeniu (limit historii serwera to 100; 2 miejsca na nowe pytanie).
export const MAX_LOADED_MESSAGES = 98;
// Taki sam limit jak MAX_USER_MESSAGE_CHARS w lib/amber-history.ts (sprawdza to test).
export const MAX_STORED_USER_CHARS = 4000;

export const CONVERSATION_MESSAGES = {
  unauthorized: "Brak dostępu: zaloguj się hasłem warsztatowym.",
  loadError: "Nie udało się wczytać rozmowy z bazy. Odśwież stronę za chwilę.",
} as const;

export type StoredRole = "user" | "assistant";
export type StoredMessage = { id: number; role: StoredRole; content: string };

// Dostęp do tabel (Supabase w aplikacji, sztuczna baza w testach).
export type ConversationDb = {
  conversationExists: (id: number) => Promise<boolean>;
  createConversation: (title: string) => Promise<number>;
  insertMessages: (rows: { conversation_id: number; role: StoredRole; content: string }[]) => Promise<void>;
  latestConversationId: () => Promise<number | null>;
  loadMessages: (conversationId: number, limit: number) => Promise<StoredMessage[]>;
};

// ---------------------------------------------------------------------------
// Tekst do zapisu
// ---------------------------------------------------------------------------

export function userTextForStorage(turn: ChatTurn): string {
  const text = turn.text.trim();
  if (!turn.image) return text.slice(0, MAX_STORED_USER_CHARS);
  const note = text ? ` ${IMAGE_NOTE}` : IMAGE_NOTE;
  return text.slice(0, MAX_STORED_USER_CHARS - note.length) + note;
}

export function assistantTextForStorage(text: string, generatedImage: boolean): string {
  const trimmed = text.trim();
  if (!generatedImage) return trimmed;
  return trimmed ? `${trimmed}\n\n${IMAGE_NOTE}` : IMAGE_NOTE;
}

// Tytuł rozmowy: początek pierwszej wiadomości klienta.
export function conversationTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Nowa rozmowa";
  return clean.length > CONVERSATION_TITLE_CHARS ? `${clean.slice(0, CONVERSATION_TITLE_CHARS - 1)}…` : clean;
}

// Wiadomości klienta bez odpowiedzi (wszystkie po ostatniej odpowiedzi Amber) – tylko one nie są jeszcze w bazie.
export function unansweredUserTurns(turns: ChatTurn[]): ChatTurn[] {
  const lastAssistant = turns.map((turn) => turn.role).lastIndexOf("assistant");
  return turns.slice(lastAssistant + 1).filter((turn) => turn.role === "user");
}

// ---------------------------------------------------------------------------
// Zapis i odczyt
// ---------------------------------------------------------------------------

export type ConversationStore = {
  // Zwraca numer rozmowy, do której zapisano wiadomości.
  saveExchange: (input: { conversationId: number | null; turns: ChatTurn[]; replyText: string; generatedImage: boolean }) => Promise<number>;
  loadLatest: () => Promise<{ conversationId: number; messages: StoredMessage[] } | null>;
};

export function createConversationStore(db: ConversationDb): ConversationStore {
  return {
    async saveExchange({ conversationId, turns, replyText, generatedImage }) {
      const users = unansweredUserTurns(turns).map(userTextForStorage);
      let id = conversationId;
      // Nieznany numer (np. rozmowa usunięta w panelu) → nowa rozmowa zamiast błędu.
      if (id !== null && !(await db.conversationExists(id))) id = null;
      if (id === null) id = await db.createConversation(conversationTitle(users[0] ?? ""));
      const rows = [
        ...users.map((content) => ({ conversation_id: id!, role: "user" as const, content })),
        { conversation_id: id, role: "assistant" as const, content: assistantTextForStorage(replyText, generatedImage) },
      ];
      await db.insertMessages(rows); // jedno polecenie → kolejne id w tej samej kolejności
      return id;
    },
    async loadLatest() {
      const conversationId = await db.latestConversationId();
      if (conversationId === null) return null;
      const messages = await db.loadMessages(conversationId, MAX_LOADED_MESSAGES);
      return { conversationId, messages };
    },
  };
}

// Wiadomości z bazy → wiadomości czatu (useChat). Odpowiedzi Amber dostają podpis v5 dla bieżącej sesji.
// Historia zaczyna się zawsze od wiadomości klienta (początkowe odpowiedzi Amber są pomijane).
export function toSignedUIMessages(
  stored: StoredMessage[],
  sign: (history: ChatTurn[]) => string,
): UIMessage[] {
  const firstUser = stored.findIndex((message) => message.role === "user");
  if (firstUser < 0) return [];
  const history: ChatTurn[] = [];
  return stored.slice(firstUser).map((message): UIMessage => {
    const text = message.role === "user" ? message.content.slice(0, MAX_STORED_USER_CHARS) : message.content;
    history.push({ role: message.role, text });
    const base = { id: `db-${message.id}`, role: message.role, parts: [{ type: "text" as const, text }] };
    return message.role === "assistant" ? { ...base, metadata: { kind: "chat", sig: sign(history) } } : base;
  });
}

// GET /api/conversations/latest – najpierw sesja (bez niej 401), dopiero potem baza.
export function createLatestConversationHandler(deps: {
  getSession: (req: Request) => { secret: string; token: string } | null;
  getStore: () => ConversationStore | null;
  sign: (session: { secret: string; token: string }, history: ChatTurn[]) => string;
  log?: (message: string) => void;
}) {
  const noStore = { "Cache-Control": "no-store" };
  return async function handleLatest(req: Request): Promise<Response> {
    const session = deps.getSession(req);
    if (!session) {
      return new Response(CONVERSATION_MESSAGES.unauthorized, {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const store = deps.getStore();
    if (!store) return Response.json({ conversationId: null, messages: [] }, { headers: noStore });
    try {
      const latest = await store.loadLatest();
      if (!latest) return Response.json({ conversationId: null, messages: [] }, { headers: noStore });
      const messages = toSignedUIMessages(latest.messages, (history) => deps.sign(session, history));
      return Response.json({ conversationId: latest.conversationId, messages }, { headers: noStore });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.error(`[Amber] /api/conversations/latest – błąd bazy: ${details.slice(0, 300)}`);
      return new Response(CONVERSATION_MESSAGES.loadError, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Supabase (tabele conversations i messages)
// ---------------------------------------------------------------------------

function dbError(action: string, error: { message?: string; code?: string } | null): Error {
  return new Error(`Supabase (${action}): ${error?.code ?? ""} ${error?.message ?? "nieznany błąd"}`.trim());
}

export function createSupabaseConversationDb(client: SupabaseClient): ConversationDb {
  return {
    async conversationExists(id) {
      const { data, error } = await client.from("conversations").select("id").eq("id", id).maybeSingle();
      if (error) throw dbError("sprawdzenie rozmowy", error);
      return data !== null;
    },
    async createConversation(title) {
      const { data, error } = await client.from("conversations").insert({ title }).select("id").single();
      if (error || !data) throw dbError("nowa rozmowa", error);
      return Number((data as { id: number }).id);
    },
    async insertMessages(rows) {
      const { error } = await client.from("messages").insert(rows);
      if (error) throw dbError("zapis wiadomości", error);
    },
    async latestConversationId() {
      // Ostatnia rozmowa = ta z najnowszą wiadomością.
      const { data, error } = await client
        .from("messages")
        .select("conversation_id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw dbError("ostatnia rozmowa", error);
      const value = (data as { conversation_id?: unknown } | null)?.conversation_id;
      return value === undefined || value === null ? null : Number(value);
    },
    async loadMessages(conversationId, limit) {
      const { data, error } = await client
        .from("messages")
        .select("id, role, content")
        .eq("conversation_id", conversationId)
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw dbError("odczyt wiadomości", error);
      return ((data ?? []) as { id: unknown; role: unknown; content: unknown }[])
        .filter((row) => (row.role === "user" || row.role === "assistant") && typeof row.content === "string")
        .map((row) => ({ id: Number(row.id), role: row.role as StoredRole, content: row.content as string }))
        .reverse();
    },
  };
}
