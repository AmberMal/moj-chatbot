// Lekcja 8, Warsztat 3 (Dla szybkich): zapisane wykonania misji – tabela mission_runs.
// Klient Supabase ZALOGOWANEJ osoby (klucz publishable + sesja), więc bazy pilnuje RLS
// („tylko wlasne wyniki misji”), a user_id wpisuje sama baza (auth.uid()). Bez klucza secret.
// Endpointy najpierw sprawdzają zalogowaną osobę (bez niej 401), dopiero potem czytają bazę.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionReport } from "./amber-missions";

export const RECENT_RUNS = 5;

export type MissionRunSummary = { id: number; utworzono: string; podglad: string };
export type MissionRunsDb = {
  insertRun: (row: { mission: string; input: string; result: string }) => Promise<number>;
  listRuns: (mission: string, limit: number) => Promise<{ id: number; created_at: string; input: string | null }[]>;
  getRun: (id: number) => Promise<{ id: number; created_at: string; mission: string; result: string | null } | null>;
};

function dbError(action: string, error: { message?: string; code?: string } | null): Error {
  return new Error(`Supabase (${action}): ${error?.code ?? ""} ${error?.message ?? "nieznany błąd"}`.trim());
}

export function createSupabaseMissionRunsDb(client: SupabaseClient): MissionRunsDb {
  return {
    async insertRun(row) {
      const { data, error } = await client.from("mission_runs").insert(row).select("id").single();
      if (error || !data) throw dbError("zapis wyniku misji", error);
      return Number((data as { id: number }).id);
    },
    async listRuns(mission, limit) {
      const { data, error } = await client
        .from("mission_runs")
        .select("id, created_at, input")
        .eq("mission", mission)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw dbError("lista wyników misji", error);
      return (data ?? []) as { id: number; created_at: string; input: string | null }[];
    },
    async getRun(id) {
      const { data, error } = await client.from("mission_runs").select("id, created_at, mission, result").eq("id", id).maybeSingle();
      if (error) throw dbError("odczyt wyniku misji", error);
      return (data as { id: number; created_at: string; mission: string; result: string | null } | null) ?? null;
    },
  };
}

// Krótki podgląd danych wejściowych na liście: początek pierwszego pola, jedna linijka.
export function inputPreview(input: string | null): string {
  let text = input ?? "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") text = Object.values(parsed as Record<string, unknown>).filter((v) => typeof v === "string").join(" ");
  } catch {
    // zostaje surowy tekst
  }
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 70 ? `${line.slice(0, 70)}…` : line;
}

// Zapisany wynik czytamy ostrożnie – w przeglądarce pokazujemy tylko poprawny raport.
export function parseStoredReport(result: string | null): MissionReport | null {
  try {
    const r = JSON.parse(result ?? "") as MissionReport;
    return r && typeof r.tytul === "string" && Array.isArray(r.sekcje) ? r : null;
  } catch {
    return null;
  }
}

export const RUNS_MESSAGES = {
  unauthorized: "Brak dostępu: zaloguj się na swoje konto.",
  badRequest: "Nieprawidłowe zapytanie.",
  notFound: "Nie znaleziono takiego wykonania misji.",
  config: "Brak konfiguracji bazy danych na serwerze.",
  dbError: "Nie udało się odczytać zapisanych wyników. Spróbuj ponownie za chwilę.",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export type RunsDeps = {
  getSession: () => Promise<unknown> | unknown;
  getDb: () => Promise<MissionRunsDb | null> | MissionRunsDb | null;
  isSavedMission: (id: string) => boolean;
  log?: (message: string) => void;
};

// GET /api/missions/runs?misja=… – 5 ostatnich wykonań zalogowanej osoby.
export function createListRunsHandler(deps: RunsDeps) {
  const log = deps.log ?? ((m: string) => console.log(m));
  return async (req: Request): Promise<Response> => {
    if (!(await deps.getSession())) return json({ komunikat: RUNS_MESSAGES.unauthorized }, 401);
    const mission = new URL(req.url).searchParams.get("misja") ?? "";
    if (!deps.isSavedMission(mission)) return json({ komunikat: RUNS_MESSAGES.badRequest }, 400);
    const db = await deps.getDb();
    if (!db) return json({ komunikat: RUNS_MESSAGES.config }, 500);
    try {
      const rows = await db.listRuns(mission, RECENT_RUNS);
      const wykonania: MissionRunSummary[] = rows.map((r) => ({ id: Number(r.id), utworzono: r.created_at, podglad: inputPreview(r.input) }));
      return json({ wykonania });
    } catch (error) {
      log(`[Amber] /api/missions/runs – ${error instanceof Error ? error.message : String(error)}`);
      return json({ komunikat: RUNS_MESSAGES.dbError }, 500);
    }
  };
}

// GET /api/missions/runs/[id] – jeden zapisany wynik (cudzy: RLS go nie zwróci → 404).
export function createGetRunHandler(deps: RunsDeps) {
  const log = deps.log ?? ((m: string) => console.log(m));
  return async (_req: Request, rawId: string): Promise<Response> => {
    if (!(await deps.getSession())) return json({ komunikat: RUNS_MESSAGES.unauthorized }, 401);
    if (!/^\d{1,15}$/.test(rawId)) return json({ komunikat: RUNS_MESSAGES.badRequest }, 400);
    const db = await deps.getDb();
    if (!db) return json({ komunikat: RUNS_MESSAGES.config }, 500);
    try {
      const row = await db.getRun(Number(rawId));
      const raport = row ? parseStoredReport(row.result) : null;
      if (!row || !raport) return json({ komunikat: RUNS_MESSAGES.notFound }, 404);
      return json({ id: Number(row.id), misja: row.mission, utworzono: row.created_at, raport });
    } catch (error) {
      log(`[Amber] /api/missions/runs/[id] – ${error instanceof Error ? error.message : String(error)}`);
      return json({ komunikat: RUNS_MESSAGES.dbError }, 500);
    }
  };
}
