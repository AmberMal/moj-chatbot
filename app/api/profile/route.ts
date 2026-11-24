import { getApiSession } from "../../../lib/auth";
import { createProfileApi } from "../../../lib/amber-profile";
import { getUserProfileStore } from "../../../lib/supabase";

// Lekcja 5, Warsztat 3 (Standard): profil klienta dla strony /profile i powitania w czacie.
// GET – podgląd, PATCH – popraw / dodaj, DELETE – usuń pozycję, imię albo cały profil.
// Najpierw sesja (bez niej 401), dopiero potem baza. Klucz Supabase zostaje na serwerze.
export const dynamic = "force-dynamic";

const api = createProfileApi({
  // Zalogowana osoba (zweryfikowana sesja Supabase) – bez niej 401, zanim dotkniemy bazy.
  getSession: () => getApiSession(),
  // Lekcja 7: profil zalogowanej osoby (klient jej sesji, RLS).
  getStore: getUserProfileStore,
});

export async function GET(req: Request) {
  return api.GET(req);
}
export async function PATCH(req: Request) {
  return api.PATCH(req);
}
export async function DELETE(req: Request) {
  return api.DELETE(req);
}
