import { getApiSession } from "../../../lib/auth";
import { AGENT_STEP_LIMIT } from "../../../lib/amber-agent";
import { createMissionHandler } from "../../../lib/amber-missions";
import { getChatModel, webSearchTool } from "../../../lib/model";

// Lekcja 8, Warsztat 2: uruchomienie misji. Najpierw zalogowana osoba (bez niej 401, zanim wywoła model).
// Nic nie zapisuje w bazie i nic nie wysyła. Misja trwa najwyżej minutę.
export const dynamic = "force-dynamic";
export const maxDuration = 70;

export async function POST(req: Request) {
  const handle = createMissionHandler({
    getSession: () => getApiSession(),
    createModel: () => getChatModel(),
    createSearchTool: () => webSearchTool(),
    // Limit kroków agenta taki sam jak w czacie.
    stepLimit: AGENT_STEP_LIMIT,
  });
  return handle(req);
}
