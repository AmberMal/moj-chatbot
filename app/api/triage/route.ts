import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiSession } from "../../../lib/auth";
import { createTriageHandler } from "../../../lib/amber-triage";
import { createSupabaseMatchChunks, searchKnowledge } from "../../../lib/amber-knowledge-search";
import { getEmbedder } from "../../../lib/model";
import { createSupabaseServerClient } from "../../../lib/supabase-auth/server";

// Lekcja 8, Warsztat 1: misja „Triage maili”. Logika: lib/amber-triage.ts.
// Najpierw zalogowana osoba (bez niej 401), dopiero potem model. Klucz API zostaje na serwerze.
// Niczego nie wysyła – zwraca tylko karty z wynikiem do przeczytania.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Klient zalogowanej osoby (RLS) – sam klient nie czyta bazy; pierwsze zapytanie dopiero po sprawdzeniu sesji.
  const client = await createSupabaseServerClient();
  const embed = getEmbedder();
  const handle = createTriageHandler({
    getSession: () => getApiSession(),
    // Standard: ta sama funkcja wyszukiwania co narzędzie searchKnowledge (embedding + match_chunks, próg 45%).
    searchKnowledge: client && embed ? (query) => searchKnowledge(query, { embed, matchChunks: createSupabaseMatchChunks(client) }) : undefined,
    createModel: () => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      const modelId = process.env.OPENROUTER_MODEL;
      if (!apiKey || !modelId) return null;
      return createOpenRouter({ apiKey })(modelId);
    },
  });
  return handle(req);
}
