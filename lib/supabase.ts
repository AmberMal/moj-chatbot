// Lekcja 5, Warsztat 2: połączenie z bazą Supabase – TYLKO po stronie serwera.
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

// Zapis i odczyt rozmów (lib/amber-conversations.ts). null = brak konfiguracji Supabase.
export function getConversationStore(): ConversationStore | null {
  const client = getSupabase();
  return client ? createConversationStore(createSupabaseConversationDb(client)) : null;
}

// Lekcja 5, Warsztat 3: profil użytkownika (lib/amber-profile.ts). null = brak konfiguracji Supabase.
export function getProfileStore(): ProfileStore | null {
  const client = getSupabase();
  return client ? createProfileStore(createSupabaseProfileDb(client)) : null;
}
