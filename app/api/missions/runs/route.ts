import { getApiSession } from "../../../../lib/auth";
import { createListRunsHandler, createSupabaseMissionRunsDb } from "../../../../lib/amber-mission-runs";
import { isSavedMission } from "../../../../lib/amber-missions";
import { createSupabaseServerClient } from "../../../../lib/supabase-auth/server";

// Lekcja 8, Warsztat 3 (Dla szybkich): 5 ostatnich wykonań misji zalogowanej osoby (RLS).
// Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
export const dynamic = "force-dynamic";

const handle = createListRunsHandler({
  getSession: () => getApiSession(),
  getDb: async () => {
    const client = await createSupabaseServerClient();
    return client ? createSupabaseMissionRunsDb(client) : null;
  },
  isSavedMission,
});

export async function GET(req: Request) {
  return handle(req);
}
