import { getApiSession } from "../../../lib/auth";
import { createUploadApi } from "../../../lib/amber-knowledge";
import { getUserKnowledgeStore } from "../../../lib/supabase";

// Lekcja 6, Warsztat 2: baza wiedzy – GET lista dokumentów, POST import z postępem (fragmenty + embeddingi),
// DELETE usunięcie dokumentu. Zawsze najpierw sesja (bez niej 401), dopiero potem baza i model.
// Klucze Supabase i OpenRouter zostają na serwerze.
export const dynamic = "force-dynamic";

const api = createUploadApi({
  // Zalogowana osoba (zweryfikowana sesja Supabase) – bez niej 401, zanim dotkniemy bazy.
  getSession: () => getApiSession(),
  // Lekcja 7: baza wiedzy zalogowanej osoby (klient jej sesji, RLS).
  getStore: getUserKnowledgeStore,
});

export async function GET(req: Request) {
  return api.GET(req);
}
export async function POST(req: Request) {
  return api.POST(req);
}
export async function DELETE(req: Request) {
  return api.DELETE(req);
}
