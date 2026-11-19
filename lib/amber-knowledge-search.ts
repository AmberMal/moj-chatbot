// Lekcja 6, Warsztat 3 (Minimum): narzędzie agenta searchKnowledge – wyszukiwanie w bazie wiedzy.
// Pytanie → embedding (ten sam model co przy imporcie, OPENROUTER_EMBEDDING_MODEL) → funkcja match_chunks w Supabase
// → 3 najlepiej pasujące fragmenty: tytuł dokumentu, treść fragmentu i podobieństwo.
// Tylko serwer: narzędzie tworzy app/api/agent/route.ts po sprawdzeniu sesji (lib/supabase.ts).
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Embedder } from "./amber-knowledge";

// Długość embeddingu – ta sama co EMBEDDING_DIMENSIONS w lib/amber-knowledge.ts i kolumna vector(1536) (sprawdza test).
export const QUERY_EMBEDDING_DIMENSIONS = 1536;

export const SEARCH_KNOWLEDGE_TOOL_NAME = "searchKnowledge";
export const SEARCH_MATCH_COUNT = 3;
export const MAX_QUERY_CHARS = 500;

export const SEARCH_KNOWLEDGE_DESCRIPTION =
  "Wyszukiwanie w bazie wiedzy (dokumenty firmy: cennik, FAQ, regulamin i inne). Używaj przy każdym pytaniu o firmę, " +
  "ofertę, ceny, zasady i regulamin. Podaj pytanie klienta własnymi słowami. Zwraca 3 najlepiej pasujące fragmenty: " +
  "tytuł dokumentu, treść fragmentu i podobieństwo (0–1).";

export const SEARCH_MESSAGES = {
  emptyQuery: "Podaj pytanie do wyszukania w bazie wiedzy.",
  error: "Nie udało się przeszukać bazy wiedzy. Powiedz klientowi, że nie możesz teraz sprawdzić tej informacji.",
  noFragments: "Baza wiedzy nie zwróciła żadnych fragmentów – nie masz tej informacji w bazie wiedzy.",
} as const;

export type KnowledgeFragment = { tytul: string; tresc: string; podobienstwo: number };
export type SearchKnowledgeResult =
  | { ok: true; fragmenty: KnowledgeFragment[]; uwaga?: string }
  | { ok: false; komunikat: string };
export type MatchChunks = (embedding: number[], count: number) => Promise<KnowledgeFragment[]>;

// Logika narzędzia (w testach z atrapą modelu i bazy).
export async function searchKnowledge(
  query: string,
  deps: { embed: Embedder; matchChunks: MatchChunks },
): Promise<SearchKnowledgeResult> {
  const pytanie = query.trim().slice(0, MAX_QUERY_CHARS);
  if (!pytanie) return { ok: false, komunikat: SEARCH_MESSAGES.emptyQuery };
  try {
    const [embedding] = await deps.embed([pytanie]);
    if (!Array.isArray(embedding) || embedding.length !== QUERY_EMBEDDING_DIMENSIONS) throw new Error("zła długość embeddingu pytania");
    const fragmenty = await deps.matchChunks(embedding, SEARCH_MATCH_COUNT);
    if (fragmenty.length === 0) return { ok: true, fragmenty: [], uwaga: SEARCH_MESSAGES.noFragments };
    return { ok: true, fragmenty: fragmenty.slice(0, SEARCH_MATCH_COUNT) };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`[Amber] searchKnowledge – błąd: ${details.slice(0, 300)}`);
    return { ok: false, komunikat: SEARCH_MESSAGES.error };
  }
}

export function createSearchKnowledgeTool(deps: { embed: Embedder; matchChunks: MatchChunks }) {
  return tool({
    description: SEARCH_KNOWLEDGE_DESCRIPTION,
    inputSchema: jsonSchema<{ pytanie: string }>({
      type: "object",
      properties: { pytanie: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS } },
      required: ["pytanie"],
      additionalProperties: false,
    }),
    execute: async ({ pytanie }) => searchKnowledge(pytanie, deps),
  });
}

// Supabase: funkcja match_chunks(query_embedding, match_count) z SQL lekcji 6 (W1).
export function createSupabaseMatchChunks(client: SupabaseClient): MatchChunks {
  return async (embedding, count) => {
    const { data, error } = await client.rpc("match_chunks", { query_embedding: embedding, match_count: count });
    if (error) throw new Error(`Supabase (match_chunks): ${error.message}`);
    return ((data ?? []) as { title: unknown; content: unknown; similarity: unknown }[]).map((row) => ({
      tytul: String(row.title),
      tresc: String(row.content),
      podobienstwo: Math.round(Number(row.similarity) * 1000) / 1000,
    }));
  };
}
