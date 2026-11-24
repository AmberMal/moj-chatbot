// Lekcja 7: klient Supabase dla serwera (strony, endpointy) – czyta ciasteczka sesji z next/headers.
// Nowy klient przy każdym zapytaniu (nigdy wspólny). null = brak konfiguracji w .env.local.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthConfig } from "./config";

export async function createSupabaseServerClient() {
  const config = getSupabaseAuthConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Komponent serwerowy nie może zapisywać ciasteczek – sesję odświeża proxy.ts.
        }
      },
    },
  });
}
