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
// Lekcja 6, Warsztat 3 (Standard): próg podobieństwa – JEDYNE miejsce w kodzie.
// Fragmenty poniżej progu nie liczą się jako źródło i nie trafiają do modelu.
// Dobrany na podstawie prób 21.11.2026 (model openai/text-embedding-3-small, dokumenty po polsku):
// – pytania z odpowiedzią w bazie: fragmenty użyte w odpowiedzi 48–65% („pakiet Start”, „pakiet Firma”, „wypowiedzenie umowy”);
// – pytanie bez odpowiedzi w bazie („płatność w ratach”): 45–58% – podobny temat, ale nie odpowiedź.
// Próg 45% odcina najsłabsze fragmenty, a zostawia wszystkie, które naprawdę odpowiadały.
// Wyższy próg nie oddzieli „podobnego tematu” od odpowiedzi – to robi zasada 4 w instrukcji (model sprawdza treść).
export const KNOWLEDGE_MIN_SIMILARITY = 0.45;
export const MAX_QUERY_CHARS = 500;

export const SEARCH_KNOWLEDGE_DESCRIPTION =
  "Wyszukiwanie w bazie wiedzy (dokumenty firmy: cennik, FAQ, regulamin i inne). Używaj przy każdym pytaniu o firmę, " +
  "ofertę, ceny, zasady i regulamin. Podaj pytanie klienta własnymi słowami. Zwraca 3 najlepiej pasujące fragmenty: " +
  "tytuł dokumentu, treść fragmentu i podobieństwo (0–1). Fragmenty o zbyt niskim podobieństwie są pomijane.";

export const SEARCH_MESSAGES = {
  emptyQuery: "Podaj pytanie do wyszukania w bazie wiedzy.",
  error: "Nie udało się przeszukać bazy wiedzy. Powiedz klientowi, że nie możesz teraz sprawdzić tej informacji.",
  noFragments: "Baza wiedzy nie zwróciła żadnych fragmentów – nie masz tej informacji w bazie wiedzy.",
  belowThreshold:
    "Baza wiedzy nie ma fragmentów wystarczająco podobnych do pytania (poniżej progu) – nie masz tej informacji w bazie wiedzy.",
} as const;

export type KnowledgeFragment = { tytul: string; tresc: string; podobienstwo: number };
export type SearchKnowledgeResult =
  | { ok: true; fragmenty: KnowledgeFragment[]; uwaga?: string; ponizejProgu?: number }
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
    const found = (await deps.matchChunks(embedding, SEARCH_MATCH_COUNT)).slice(0, SEARCH_MATCH_COUNT);
    if (found.length === 0) return { ok: true, fragmenty: [], uwaga: SEARCH_MESSAGES.noFragments };
    // Standard: fragmenty o niskim podobieństwie odrzucamy (próg w jednym miejscu: KNOWLEDGE_MIN_SIMILARITY).
    const fragmenty = found.filter((fragment) => fragment.podobienstwo >= KNOWLEDGE_MIN_SIMILARITY);
    const ponizejProgu = found.length - fragmenty.length;
    // Do doboru progu: wszystkie podobieństwa w logu serwera (bez treści fragmentów).
    console.log(
      `[Amber] searchKnowledge – podobieństwa: ${found.map((f) => `${f.tytul} ${Math.round(f.podobienstwo * 100)}%`).join(" | ")}` +
        ` (próg ${Math.round(KNOWLEDGE_MIN_SIMILARITY * 100)}%, odrzucone: ${ponizejProgu})`,
    );
    if (fragmenty.length === 0) return { ok: true, fragmenty: [], uwaga: SEARCH_MESSAGES.belowThreshold, ponizejProgu };
    return { ok: true, fragmenty, ...(ponizejProgu > 0 ? { ponizejProgu } : {}) };
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
