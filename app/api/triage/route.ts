import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiSession } from "../../../lib/auth";
import { createTriageHandler } from "../../../lib/amber-triage";

// Lekcja 8, Warsztat 1: misja „Triage maili”. Logika: lib/amber-triage.ts.
// Najpierw zalogowana osoba (bez niej 401), dopiero potem model. Klucz API zostaje na serwerze.
// Niczego nie wysyła – zwraca tylko karty z wynikiem do przeczytania.
export const dynamic = "force-dynamic";

const handle = createTriageHandler({
  getSession: () => getApiSession(),
  createModel: () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelId = process.env.OPENROUTER_MODEL;
    if (!apiKey || !modelId) return null;
    return createOpenRouter({ apiKey })(modelId);
  },
});

export async function POST(req: Request) {
  return handle(req);
}
