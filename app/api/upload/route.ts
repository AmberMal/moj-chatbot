import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import { createUploadApi } from "../../../lib/amber-knowledge";
import { getKnowledgeStore } from "../../../lib/supabase";

// Lekcja 6, Warsztat 2 (Minimum, krok A): zapis dokumentu do bazy wiedzy (documents + chunks, bez embeddingów).
// Najpierw sesja (bez niej 401), dopiero potem baza. Klucz Supabase zostaje na serwerze.
export const dynamic = "force-dynamic";

const api = createUploadApi({
  getSession: (request) => {
    const authConfig = getAuthConfig();
    const token = readCookie(request, SESSION_COOKIE);
    if (!authConfig || !token || !isSessionValid(token, authConfig)) return null;
    return { token };
  },
  getStore: getKnowledgeStore,
});

export async function POST(req: Request) {
  return api.POST(req);
}
