import { getApiSession } from "../../../../../lib/auth";
import { createGetRunHandler, createSupabaseMissionRunsDb } from "../../../../../lib/amber-mission-runs";
import { isSavedMission } from "../../../../../lib/amber-missions";
import { createSupabaseServerClient } from "../../../../../lib/supabase-auth/server";

// Lekcja 8, Warsztat 3 (Dla szybkich): jeden zapisany wynik misji. Cudzy – RLS go nie zwróci → 404.
// Najpierw sesja – bez niej 401, zanim cokolwiek zostanie odczytane z bazy.
export const dynamic = "force-dynamic";

const handle = createGetRunHandler({
  getSession: () => getApiSession(),
  getDb: async () => {
    const client = await createSupabaseServerClient();
    return client ? createSupabaseMissionRunsDb(client) : null;
  },
  isSavedMission,
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id);
}
