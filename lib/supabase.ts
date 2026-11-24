// Lekcja 5, Warsztat 2: połączenie z bazą Supabase – TYLKO po stronie serwera.
// Lekcja 7, Warsztat 2: rozmowy, wiadomości i profil – klientem ZALOGOWANEJ osoby (klucz publishable + sesja
// z ciasteczek), więc bazy pilnuje RLS („tylko własne wiersze”), a user_id wpisuje sama baza (auth.uid()).
// Baza wiedzy (documents, chunks, match_chunks) – nadal wspólna, kluczem secret.
// Klucz secret (SUPABASE_SECRET_KEY) omija RLS, dlatego nigdy nie może trafić do przeglądarki:
// ten plik importują wyłącznie pliki serwerowe (app/api/...), a nazwy zmiennych nie mają przedrostka NEXT_PUBLIC_.
// Brak zmiennych = null: czat działa dalej, tylko bez zapisu rozmów (wpis w logu serwera).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createConversationStore,
  createSupabaseConversationDb,
  type ConversationStore,
} from "./amber-conversations";
import { createProfileStore, createSupabaseProfileDb, type ProfileStore } from "./amber-profile";
import { createKnowledgeStore, createSupabaseKnowledgeDb, type KnowledgeStore } from "./amber-knowledge";
import { getEmbedder } from "./model";
import { createSearchKnowledgeTool, createSupabaseMatchChunks } from "./amber-knowledge-search";
import { createSupabaseServerClient } from "./supabase-auth/server";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window !== "undefined") throw new Error("lib/supabase.ts działa tylko na serwerze.");
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  cached = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

// Lekcja 7: magazyny danych osoby zalogowanej – z klienta jej sesji (RLS). Bez klucza secret.
export function createUserStores(userClient: SupabaseClient | null): {
  conversations: ConversationStore | null;
  profile: ProfileStore | null;
} {
  if (!userClient) return { conversations: null, profile: null };
  return {
    conversations: createConversationStore(createSupabaseConversationDb(userClient)),
    profile: createProfileStore(createSupabaseProfileDb(userClient)),
  };
}

// Zapis i odczyt rozmów zalogowanej osoby (lib/amber-conversations.ts). null = brak konfiguracji Supabase.
// Wywoływać dopiero PO sprawdzeniu sesji (endpointy i strony najpierw sprawdzają użytkownika).
export async function getUserConversationStore(): Promise<ConversationStore | null> {
  return createUserStores(await createSupabaseServerClient()).conversations;
}

// Lekcja 5 → 7: profil zalogowanej osoby (jeden wiersz na użytkownika, RLS). null = brak konfiguracji Supabase.
export async function getUserProfileStore(): Promise<ProfileStore | null> {
  return createUserStores(await createSupabaseServerClient()).profile;
}

// Lekcja 6, Warsztat 2: baza wiedzy – dokumenty, fragmenty i ich embeddingi (lib/amber-knowledge.ts).
// null = brak konfiguracji Supabase. Brak modelu embeddingów zgłasza sam zapis (komunikat po polsku).
export function getKnowledgeStore(): KnowledgeStore | null {
  const client = getSupabase();
  return client ? createKnowledgeStore(createSupabaseKnowledgeDb(client), getEmbedder()) : null;
}

// Lekcja 6, Warsztat 3: narzędzie agenta searchKnowledge. null = brak Supabase albo modelu embeddingów.
export function getSearchKnowledgeTool() {
  const client = getSupabase();
  const embed = getEmbedder();
  return client && embed ? createSearchKnowledgeTool({ embed, matchChunks: createSupabaseMatchChunks(client) }) : null;
}
