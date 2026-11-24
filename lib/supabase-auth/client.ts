// Lekcja 7: klient Supabase dla przeglądarki (logowanie, rejestracja, wylogowanie).
// Ciasteczka sesji zapisuje sam pakiet @supabase/ssr. null = brak konfiguracji w .env.local.
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAuthConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = getSupabaseAuthConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
