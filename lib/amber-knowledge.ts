// Lekcja 6, Warsztat 2 (Minimum): baza wiedzy – zapis dokumentu, podział na fragmenty (krok A)
// i embeddingi fragmentów (krok B: embedMany, model z OPENROUTER_EMBEDDING_MODEL – lib/model.ts).
// Tabele documents i chunks (SQL z lekcji 6, W1). Połączenie z bazą tylko na serwerze (lib/supabase.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

export const UPLOAD_PAGE = "/upload";
export const UPLOAD_API = "/api/upload";
export const MAX_TITLE_CHARS = 200;
export const MAX_CONTENT_CHARS = 20000;
export const MAX_CHUNK_CHARS = 800;
export const EMBEDDING_DIMENSIONS = 1536; // kolumna chunks.embedding vector(1536)
export const MAX_BACKFILL_CHUNKS = 200; // ile starych fragmentów bez embeddingu uzupełniamy przy jednym imporcie

export const KNOWLEDGE_MESSAGES = {
  unauthorized: "Zaloguj się, aby dodawać dokumenty do bazy wiedzy.",
  notConfigured: "Baza wiedzy nie jest skonfigurowana. Uzupełnij dane Supabase w .env.local i uruchom ponownie serwer.",
  badRequest: "Nieprawidłowe dane formularza. Odśwież stronę i spróbuj ponownie.",
  emptyTitle: "Wpisz tytuł dokumentu.",
  emptyContent: "Wklej treść dokumentu.",
  titleTooLong: `Tytuł może mieć najwyżej ${MAX_TITLE_CHARS} znaków.`,
  contentTooLong: `Treść może mieć najwyżej ${MAX_CONTENT_CHARS} znaków.`,
  saveError: "Nie udało się zapisać dokumentu w bazie wiedzy. Nic nie zostało zapisane – spróbuj ponownie za chwilę.",
  embeddingNotConfigured:
    "Model embeddingów nie jest skonfigurowany (OPENROUTER_EMBEDDING_MODEL w .env.local). Nic nie zostało zapisane.",
  embeddingError: "Nie udało się utworzyć embeddingów dla dokumentu. Nic nie zostało zapisane – spróbuj ponownie za chwilę.",
  connection: "Brak połączenia z serwerem. Spróbuj ponownie.",
} as const;

export function savedMessage(title: string, count: number): string {
  return `Zapisano dokument „${title}”: ${count} fragmentów`;
}

// Sprawdzenie formularza (to samo w przeglądarce i na serwerze).
export function checkUploadInput(
  body: unknown,
): { ok: true; title: string; content: string } | { ok: false; komunikat: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, komunikat: KNOWLEDGE_MESSAGES.badRequest };
  const { tytul, tresc } = body as Record<string, unknown>;
  if (typeof tytul !== "string" || typeof tresc !== "string") return { ok: false, komunikat: KNOWLEDGE_MESSAGES.badRequest };
  const title = tytul.trim();
  const content = tresc.replace(/\r\n?/g, "\n").trim();
  if (!title) return { ok: false, komunikat: KNOWLEDGE_MESSAGES.emptyTitle };
  if (!content) return { ok: false, komunikat: KNOWLEDGE_MESSAGES.emptyContent };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, komunikat: KNOWLEDGE_MESSAGES.titleTooLong };
  if (content.length > MAX_CONTENT_CHARS) return { ok: false, komunikat: KNOWLEDGE_MESSAGES.contentTooLong };
  return { ok: true, title, content };
}

// Podział na fragmenty: jeden akapit (tekst oddzielony pustą linią) = jeden fragment.
// Krótkich akapitów NIE łączymy. Akapit dłuższy niż 800 znaków dzielimy na granicy zdania.
export function splitIntoChunks(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return paragraphs.flatMap((paragraph) =>
    paragraph.length <= MAX_CHUNK_CHARS ? [paragraph] : splitLongParagraph(paragraph),
  );
}

function splitLongParagraph(paragraph: string): string[] {
  // Zdanie kończy się kropką, wykrzyknikiem, pytajnikiem albo wielokropkiem (z ewentualnym cudzysłowem/nawiasem).
  const sentences = paragraph.split(/(?<=[.!?…]["”’)]?)\s+/).filter((sentence) => sentence.length > 0);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    // Pojedyncze zdanie dłuższe niż limit – wyjątkowo tniemy je na granicy słowa.
    const pieces = sentence.length > MAX_CHUNK_CHARS ? splitAtWords(sentence) : [sentence];
    for (const piece of pieces) {
      const joined = current ? `${current} ${piece}` : piece;
      if (joined.length <= MAX_CHUNK_CHARS) {
        current = joined;
      } else {
        if (current) parts.push(current);
        current = piece;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitAtWords(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
    const cut = space > 0 ? space : MAX_CHUNK_CHARS;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// Dostęp do bazy (w testach podmieniany na atrapę).
export type ChunkRow = { document_id: number; chunk_index: number; content: string; embedding: number[] };
export type KnowledgeDb = {
  insertDocument(title: string): Promise<number>;
  insertChunks(rows: ChunkRow[]): Promise<void>;
  deleteDocument(id: number): Promise<void>;
  findChunksWithoutEmbedding(limit: number): Promise<{ id: number; content: string }[]>;
  updateEmbedding(id: number, embedding: number[]): Promise<void>;
};
export type Embedder = (values: string[]) => Promise<number[][]>;

export type KnowledgeStore = {
  saveDocument(title: string, content: string): Promise<{ id: number; count: number; backfilled: number }>;
};

// Błąd z etapem – endpoint wybiera po nim komunikat dla użytkownika.
export class KnowledgeError extends Error {
  readonly stage: "embedding-config" | "embedding" | "db";
  constructor(stage: "embedding-config" | "embedding" | "db", message: string) {
    super(message);
    this.stage = stage;
  }
}

export function createKnowledgeStore(db: KnowledgeDb, embed: Embedder | null): KnowledgeStore {
  return {
    async saveDocument(title, content) {
      if (!embed) throw new KnowledgeError("embedding-config", "Brak OPENROUTER_EMBEDDING_MODEL.");
      const chunks = splitIntoChunks(content);
      // Stare fragmenty z pustą kolumną embedding – uzupełniamy je przy okazji tego importu.
      const missing = await db.findChunksWithoutEmbedding(MAX_BACKFILL_CHUNKS);

      // Embeddingi nowych i starych fragmentów JEDNYM wywołaniem (embedMany).
      const values = [...chunks, ...missing.map((chunk) => chunk.content)];
      let embeddings: number[][];
      try {
        embeddings = await embed(values);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new KnowledgeError("embedding", `embedMany: ${details}`);
      }
      const valid =
        embeddings.length === values.length &&
        embeddings.every((vector) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS);
      if (!valid) throw new KnowledgeError("embedding", "Model zwrócił niepełne embeddingi albo złą długość wektora.");

      // Uzupełnienie starych fragmentów (dokument jeszcze nie istnieje – nie ma czego sprzątać).
      for (const [index, chunk] of missing.entries()) {
        await db.updateEmbedding(chunk.id, embeddings[chunks.length + index]);
      }

      const id = await db.insertDocument(title);
      try {
        await db.insertChunks(
          chunks.map((chunk, index) => ({ document_id: id, chunk_index: index, content: chunk, embedding: embeddings[index] })),
        );
      } catch (error) {
        // Zapis się nie udał – usuwamy niedokończony dokument (fragmenty znikają razem z nim: on delete cascade).
        await db.deleteDocument(id).catch((cleanupError: unknown) => {
          const details = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          console.error(`[Amber] /api/upload – nie udało się usunąć niedokończonego dokumentu ${id}: ${details.slice(0, 300)}`);
        });
        throw error;
      }
      return { id, count: chunks.length, backfilled: missing.length };
    },
  };
}

function dbError(action: string, error: { message?: string }) {
  return new Error(`Supabase (${action}): ${error.message ?? "nieznany błąd"}`);
}

export function createSupabaseKnowledgeDb(client: SupabaseClient): KnowledgeDb {
  return {
    async insertDocument(title) {
      const { data, error } = await client.from("documents").insert({ title }).select("id").single();
      if (error || !data) throw dbError("nowy dokument", error ?? {});
      return Number((data as { id: unknown }).id);
    },
    async insertChunks(rows) {
      const { error } = await client.from("chunks").insert(rows);
      if (error) throw dbError("fragmenty", error);
    },
    async deleteDocument(id) {
      const { error } = await client.from("documents").delete().eq("id", id);
      if (error) throw dbError("usunięcie dokumentu", error);
    },
    async findChunksWithoutEmbedding(limit) {
      const { data, error } = await client
        .from("chunks")
        .select("id, content")
        .is("embedding", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw dbError("fragmenty bez embeddingu", error);
      return ((data ?? []) as { id: unknown; content: unknown }[]).map((row) => ({
        id: Number(row.id),
        content: String(row.content),
      }));
    },
    async updateEmbedding(id, embedding) {
      const { error } = await client.from("chunks").update({ embedding }).eq("id", id);
      if (error) throw dbError("uzupełnienie embeddingu", error);
    },
  };
}

// Endpoint /api/upload: najpierw sesja (bez niej 401), dopiero potem baza.
export function createUploadApi(deps: {
  getSession: (req: Request) => unknown | null;
  getStore: () => KnowledgeStore | null;
}) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  return {
    async POST(req: Request): Promise<Response> {
      if (!deps.getSession(req)) return json({ komunikat: KNOWLEDGE_MESSAGES.unauthorized }, 401);
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        return json({ komunikat: KNOWLEDGE_MESSAGES.badRequest }, 400);
      }
      const check = checkUploadInput(body);
      if (!check.ok) return json({ komunikat: check.komunikat }, 400);
      const store = deps.getStore();
      if (!store) return json({ komunikat: KNOWLEDGE_MESSAGES.notConfigured }, 503);
      try {
        const saved = await store.saveDocument(check.title, check.content);
        return json({ komunikat: savedMessage(check.title, saved.count), fragmenty: saved.count });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        const stage = error instanceof KnowledgeError ? error.stage : "db";
        console.error(`[Amber] POST /api/upload – błąd (${stage}): ${details.slice(0, 300)}`);
        if (stage === "embedding-config") return json({ komunikat: KNOWLEDGE_MESSAGES.embeddingNotConfigured }, 503);
        if (stage === "embedding") return json({ komunikat: KNOWLEDGE_MESSAGES.embeddingError }, 502);
        return json({ komunikat: KNOWLEDGE_MESSAGES.saveError }, 502);
      }
    },
  };
}
