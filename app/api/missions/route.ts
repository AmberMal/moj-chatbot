import { getApiSession } from "../../../lib/auth";
import { AGENT_STEP_LIMIT } from "../../../lib/amber-agent";
import { createMissionHandler } from "../../../lib/amber-missions";
import { createSupabaseMatchChunks, searchKnowledge } from "../../../lib/amber-knowledge-search";
import { getChatModel, getEmbedder, webSearchTool } from "../../../lib/model";
import { createSupabaseServerClient } from "../../../lib/supabase-auth/server";
import { createSupabaseMissionRunsDb } from "../../../lib/amber-mission-runs";

// Lekcja 8, Warsztat 2: uruchomienie misji. Najpierw zalogowana osoba (bez niej 401, zanim wywoła model).
// Nic nie wysyła. Wyniki misji z „zapisuj” (Notatka z wizyty) zapisuje w mission_runs. Misja trwa najwyżej minutę.
export const dynamic = "force-dynamic";
export const maxDuration = 70;

export async function POST(req: Request) {
  // Warsztat 3: baza wiedzy przez klienta zalogowanej osoby (RLS) – pierwsze zapytanie dopiero po sprawdzeniu sesji.
  const client = await createSupabaseServerClient();
  const embed = getEmbedder();
  const handle = createMissionHandler({
    getSession: () => getApiSession(),
    createModel: () => getChatModel(),
    createSearchTool: () => webSearchTool(),
    // Limit kroków agenta taki sam jak w czacie.
    stepLimit: AGENT_STEP_LIMIT,
    // Dla szybkich: zapis wyniku w mission_runs klientem zalogowanej osoby (RLS, user_id wpisuje baza).
    saveRun: client ? (row) => createSupabaseMissionRunsDb(client).insertRun(row) : null,
    searchKnowledge: client && embed ? (query) => searchKnowledge(query, { embed, matchChunks: createSupabaseMatchChunks(client) }) : null,
  });
  return handle(req);
}
