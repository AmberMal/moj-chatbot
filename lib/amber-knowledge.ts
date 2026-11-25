// Lekcja 6, Warsztat 2 (Minimum): baza wiedzy – zapis dokumentu, podział na fragmenty (krok A)
// i embeddingi fragmentów (krok B: embedMany, model z OPENROUTER_EMBEDDING_MODEL – lib/model.ts).
// Warsztat 2 (Standard): postęp importu (etapy), lista dokumentów, zastępowanie po tytule, „Usuń”, błędy z etapem.
// Warsztat 2 (Dla szybkich, wyzwanie): wybór sposobu dzielenia – „akapity” (domyślnie) albo „stałe kawałki”.
// Tabele documents i chunks (SQL z lekcji 6, W1). Połączenie z bazą tylko na serwerze (lib/supabase.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

export const UPLOAD_PAGE = "/upload";
export const UPLOAD_API = "/api/upload";
export const MAX_TITLE_CHARS = 200;
export const MAX_CONTENT_CHARS = 20000;
export const MAX_CHUNK_CHARS = 800;
export const FIXED_CHUNK_CHARS = 300; // „stałe kawałki”: długość kawałka
export const FIXED_CHUNK_OVERLAP = 50; // „stałe kawałki”: zakładka – tyle znaków powtarza się z poprzedniego kawałka
export type SplitMode = "akapity" | "kawalki";
export const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "akapity", label: "akapity" },
  { value: "kawalki", label: "stałe kawałki (300 znaków, zakładka 50)" },
];
export const EMBEDDING_DIMENSIONS = 1536; // kolumna chunks.embedding vector(1536)
export const MAX_BACKFILL_CHUNKS = 200; // ile starych fragmentów bez embeddingu uzupełniamy przy jednym imporcie

export const KNOWLEDGE_MESSAGES = {
  unauthorized: "Zaloguj się, aby korzystać z bazy wiedzy.",
  notConfigured: "Baza wiedzy nie jest skonfigurowana. Uzupełnij dane Supabase w .env.local i uruchom ponownie serwer.",
  badRequest: "Nieprawidłowe dane formularza. Odśwież stronę i spróbuj ponownie.",
  emptyTitle: "Wpisz tytuł dokumentu.",
  emptyContent: "Wklej treść dokumentu.",
  titleTooLong: `Tytuł może mieć najwyżej ${MAX_TITLE_CHARS} znaków.`,
  contentTooLong: `Treść może mieć najwyżej ${MAX_CONTENT_CHARS} znaków.`,
  exists: "W bazie jest już dokument o tym tytule. Potwierdź, że chcesz zastąpić poprzednią wersję.",
  listError: "Nie udało się wczytać listy dokumentów. Odśwież stronę za chwilę.",
  deleteError: "Nie udało się usunąć dokumentu. Spróbuj ponownie za chwilę.",
  deleted: "Usunięto dokument.",
  notFound: "Nie znaleziono tego dokumentu.",
  connection: "Brak połączenia z serwerem. Spróbuj ponownie.",
} as const;

// Etapy importu (Standard): komunikat postępu i nazwa etapu w komunikacie błędu.
export type UploadStage = "split" | "embed" | "save";
export const STAGE_PROGRESS: Record<UploadStage, string> = {
  split: "Dzielę tekst…",
  embed: "Tworzę embeddingi…",
  save: "Zapisuję…",
};
const STAGE_NAMES: Record<UploadStage, string> = {
  split: "dzielenie tekstu",
  embed: "tworzenie embeddingów",
  save: "zapis w bazie",
};
const STAGE_ADVICE: Record<UploadStage, string> = {
  split: "sprawdź, czy treść nie jest pusta, i spróbuj ponownie.",
  embed:
    "spróbuj ponownie za chwilę. Jeśli błąd się powtarza, sprawdź w .env.local zmienną OPENROUTER_EMBEDDING_MODEL i klucz OpenRouter, a potem uruchom ponownie serwer.",
  save: "spróbuj ponownie za chwilę. Jeśli błąd się powtarza, sprawdź w panelu Supabase, czy projekt działa.",
};

export function stageErrorMessage(stage: UploadStage, details?: string): string {
  const what = details ? ` ${details}` : "";
  return `Nie udało się na etapie: ${STAGE_NAMES[stage]}.${what} Nic nie zostało zapisane. Co możesz zrobić: ${STAGE_ADVICE[stage]}`;
}
export function interruptedMessage(stage: UploadStage | null): string {
  const where = stage ? ` na etapie: ${STAGE_NAMES[stage]}` : "";
  return `Połączenie z serwerem przerwało się${where}. Co możesz zrobić: sprawdź na liście poniżej, czy dokument się zapisał, i w razie potrzeby dodaj go ponownie.`;
}
export const EMBEDDING_NOT_CONFIGURED_DETAILS = "Brak modelu embeddingów (OPENROUTER_EMBEDDING_MODEL w .env.local).";
export const OLD_VERSION_NOT_DELETED =
  "Nowa wersja jest zapisana, ale nie udało się usunąć poprzedniej. Co możesz zrobić: usuń starszą wersję (wcześniejsza data) przyciskiem „Usuń” na liście.";

export function replaceQuestion(title: string): string {
  return `W bazie wiedzy jest już dokument „${title}”. Zastąpić poprzednią wersję? Stare fragmenty zostaną usunięte, zostaną tylko nowe.`;
}
export function deleteQuestion(title: string, count: number): string {
  return `Usunąć dokument „${title}” (${count} fragmentów) z bazy wiedzy? Tej operacji nie można cofnąć.`;
}

// Data dodania (= wersja dokumentu) – stała strefa czasowa, żeby serwer i przeglądarka pokazały to samo.
export function formatAddedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function savedMessage(title: string, count: number): string {
  return `Zapisano dokument „${title}”: ${count} fragmentów`;
}

export type DocumentSummary = { id: number; title: string; createdAt: string; chunks: number };

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

// „Stałe kawałki”: po 300 znaków, każdy kolejny zaczyna się 50 znaków przed końcem poprzedniego.
export function splitIntoFixedChunks(text: string): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const step = FIXED_CHUNK_CHARS - FIXED_CHUNK_OVERLAP;
  const parts: string[] = [];
  for (let start = 0; start < clean.length; start += step) {
    const part = clean.slice(start, start + FIXED_CHUNK_CHARS).trim();
    if (part) parts.push(part);
    if (start + FIXED_CHUNK_CHARS >= clean.length) break;
  }
  return parts;
}

export function splitText(text: string, mode: SplitMode): string[] {
  return mode === "kawalki" ? splitIntoFixedChunks(text) : splitIntoChunks(text);
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
  // Lekcja 7: false = nic nie usunięto (nie ma takiego dokumentu albo należy do innej osoby – RLS).
  deleteDocument(id: number): Promise<boolean | void>;
  findChunksWithoutEmbedding(limit: number): Promise<{ id: number; document_id: number; content: string }[]>;
  updateEmbedding(id: number, embedding: number[]): Promise<void>;
  listDocuments(): Promise<DocumentSummary[]>;
  findDocumentIdsByTitle(title: string): Promise<number[]>;
};
export type Embedder = (values: string[]) => Promise<number[][]>;

export type SaveResult = { id: number; count: number; backfilled: number; replaced: number; oldVersionLeft: boolean };
export type KnowledgeStore = {
  saveDocument(
    title: string,
    content: string,
    options?: { replace?: boolean; mode?: SplitMode; onStage?: (stage: UploadStage) => void },
  ): Promise<SaveResult>;
  listDocuments(): Promise<DocumentSummary[]>;
  hasTitle(title: string): Promise<boolean>;
  // Lekcja 7: false = nic nie usunięto (nie ma takiego dokumentu albo należy do innej osoby – RLS).
  deleteDocument(id: number): Promise<boolean | void>;
};

// Błąd z etapem – endpoint wybiera po nim komunikat dla użytkownika.
export type KnowledgeErrorKind = "embedding-config" | "embedding" | "db" | "exists";
export class KnowledgeError extends Error {
  readonly kind: KnowledgeErrorKind;
  readonly stage: UploadStage;
  constructor(kind: KnowledgeErrorKind, stage: UploadStage, message: string) {
    super(message);
    this.kind = kind;
    this.stage = stage;
  }
}

export function createKnowledgeStore(db: KnowledgeDb, embed: Embedder | null): KnowledgeStore {
  return {
    listDocuments: () => db.listDocuments(),
    async hasTitle(title) {
      return (await db.findDocumentIdsByTitle(title)).length > 0;
    },
    deleteDocument: (id) => db.deleteDocument(id),

    async saveDocument(title, content, options = {}) {
      const onStage = options.onStage ?? (() => {});
      let stage: UploadStage = "split";
      const fail = (kind: KnowledgeErrorKind, error: unknown): never => {
        if (error instanceof KnowledgeError) throw error;
        const details = error instanceof Error ? error.message : String(error);
        throw new KnowledgeError(kind, stage, details);
      };

      // 1. Dzielę tekst
      onStage("split");
      const oldIds = await db.findDocumentIdsByTitle(title).catch((error: unknown) => fail("db", error));
      if (oldIds.length > 0 && !options.replace) throw new KnowledgeError("exists", "split", "Dokument o tym tytule już istnieje.");
      const chunks = splitText(content, options.mode ?? "akapity");
      if (chunks.length === 0) throw new KnowledgeError("db", "split", "Brak fragmentów po podziale.");

      // 2. Tworzę embeddingi – nowe fragmenty i stare z pustą kolumną embedding, JEDNYM wywołaniem (embedMany)
      stage = "embed";
      onStage("embed");
      if (!embed) throw new KnowledgeError("embedding-config", "embed", "Brak OPENROUTER_EMBEDDING_MODEL.");
      const missing = (await db.findChunksWithoutEmbedding(MAX_BACKFILL_CHUNKS).catch((error: unknown) => fail("db", error)))
        // fragmenty dokumentu, który zaraz zastąpimy, nie potrzebują embeddingu
        .filter((chunk) => !oldIds.includes(chunk.document_id));
      const values = [...chunks, ...missing.map((chunk) => chunk.content)];
      const embeddings = await embed(values).catch((error: unknown) => fail("embedding", error));
      const valid =
        embeddings.length === values.length &&
        embeddings.every((vector) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS);
      if (!valid) throw new KnowledgeError("embedding", "embed", "Model zwrócił niepełne embeddingi albo złą długość wektora.");

      // 3. Zapisuję – najpierw nowa wersja w całości, dopiero potem usuwamy starą (przy błędzie stara zostaje)
      stage = "save";
      onStage("save");
      try {
        for (const [index, chunk] of missing.entries()) {
          await db.updateEmbedding(chunk.id, embeddings[chunks.length + index]);
        }
      } catch (error) {
        fail("db", error);
      }
      const id = await db.insertDocument(title).catch((error: unknown) => fail("db", error));
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
        fail("db", error);
      }
      let oldVersionLeft = false;
      for (const oldId of oldIds) {
        try {
          await db.deleteDocument(oldId); // stare fragmenty znikają razem z dokumentem (on delete cascade)
        } catch (error) {
          oldVersionLeft = true;
          const details = error instanceof Error ? error.message : String(error);
          console.error(`[Amber] /api/upload – nie udało się usunąć starej wersji ${oldId}: ${details.slice(0, 300)}`);
        }
      }
      return { id, count: chunks.length, backfilled: missing.length, replaced: oldIds.length, oldVersionLeft };
    },
  };
}

function dbError(action: string, error: { message?: string }) {
  return new Error(`Supabase (${action}): ${error.message ?? "nieznany błąd"}`);
}

export function createSupabaseKnowledgeDb(client: SupabaseClient): KnowledgeDb {
  // Lekcja 7 (wspólna baza firmy): dokumenty oznaczone w bazie jako „wspolny” może CZYTAĆ każdy zalogowany
  // (wyszukiwanie searchKnowledge). Zarządzanie (lista na /upload, zastępowanie po tytule, uzupełnianie
  // embeddingów) – tylko własne dokumenty. Właściciel z sesji (getUser), nigdy z zapytania.
  let ownerPromise: Promise<string | null> | null = null;
  const ownerId = () =>
    (ownerPromise ??= client.auth.getUser().then(({ data }) => data.user?.id ?? null, () => null));
  async function requireOwner(action: string): Promise<string> {
    const id = await ownerId();
    if (!id) throw dbError(action, { message: "brak zalogowanej osoby" });
    return id;
  }
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
      const { data, error } = await client.from("documents").delete().eq("id", id).select("id");
      if (error) throw dbError("usunięcie dokumentu", error);
      return Array.isArray(data) && data.length > 0;
    },
    async findChunksWithoutEmbedding(limit) {
      const owner = await requireOwner("fragmenty bez embeddingu");
      const { data, error } = await client
        .from("chunks")
        .select("id, document_id, content")
        .eq("user_id", owner)
        .is("embedding", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw dbError("fragmenty bez embeddingu", error);
      return ((data ?? []) as { id: unknown; document_id: unknown; content: unknown }[]).map((row) => ({
        id: Number(row.id),
        document_id: Number(row.document_id),
        content: String(row.content),
      }));
    },
    async updateEmbedding(id, embedding) {
      const { error } = await client.from("chunks").update({ embedding }).eq("id", id);
      if (error) throw dbError("uzupełnienie embeddingu", error);
    },
    async listDocuments() {
      // chunks(count) – liczba fragmentów z powiązanej tabeli (relacja document_id).
      const owner = await requireOwner("lista dokumentów");
      const { data, error } = await client
        .from("documents")
        .select("id, title, created_at, chunks(count)")
        .eq("user_id", owner)
        .order("created_at", { ascending: false });
      if (error) throw dbError("lista dokumentów", error);
      return ((data ?? []) as { id: unknown; title: unknown; created_at: unknown; chunks: unknown }[]).map((row) => {
        const counted = Array.isArray(row.chunks) ? (row.chunks[0] as { count?: unknown } | undefined)?.count : undefined;
        return {
          id: Number(row.id),
          title: String(row.title),
          createdAt: String(row.created_at),
          chunks: Number(counted ?? 0),
        };
      });
    },
    async findDocumentIdsByTitle(title) {
      const owner = await requireOwner("szukanie po tytule");
      const { data, error } = await client.from("documents").select("id").eq("user_id", owner).eq("title", title);
      if (error) throw dbError("szukanie po tytule", error);
      return ((data ?? []) as { id: unknown }[]).map((row) => Number(row.id));
    },
  };
}

// Endpoint /api/upload: najpierw sesja (bez niej 401), dopiero potem baza i model.
// GET – lista dokumentów; POST – import z postępem (kolejne linie JSON); DELETE – usunięcie dokumentu.
export type UploadEvent =
  | { typ: "etap"; etap: UploadStage }
  | { typ: "gotowe"; komunikat: string; fragmenty: number; ostrzezenie?: string }
  | { typ: "blad"; etap: UploadStage; komunikat: string };

export function createUploadApi(deps: {
  getSession: (req: Request) => unknown | Promise<unknown>;
  getStore: () => KnowledgeStore | null | Promise<KnowledgeStore | null>;
}) {
  const headers = { "Cache-Control": "no-store" };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const logError = (label: string, error: unknown) => {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`[Amber] ${label} /api/upload – błąd: ${details.slice(0, 300)}`);
  };
  async function readBody(req: Request): Promise<unknown> {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }

  return {
    async GET(req: Request): Promise<Response> {
      if (!(await deps.getSession(req))) return json({ komunikat: KNOWLEDGE_MESSAGES.unauthorized }, 401);
      const store = await deps.getStore();
      if (!store) return json({ komunikat: KNOWLEDGE_MESSAGES.notConfigured }, 503);
      try {
        return json({ dokumenty: await store.listDocuments() });
      } catch (error) {
        logError("GET", error);
        return json({ komunikat: KNOWLEDGE_MESSAGES.listError }, 502);
      }
    },

    async DELETE(req: Request): Promise<Response> {
      if (!(await deps.getSession(req))) return json({ komunikat: KNOWLEDGE_MESSAGES.unauthorized }, 401);
      const body = (await readBody(req)) as { id?: unknown } | null;
      const id = body && typeof body === "object" ? body.id : undefined;
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return json({ komunikat: KNOWLEDGE_MESSAGES.badRequest }, 400);
      const store = await deps.getStore();
      if (!store) return json({ komunikat: KNOWLEDGE_MESSAGES.notConfigured }, 503);
      try {
        const deleted = await store.deleteDocument(id);
        if (deleted === false) return json({ komunikat: KNOWLEDGE_MESSAGES.notFound }, 404);
        return json({ komunikat: KNOWLEDGE_MESSAGES.deleted, dokumenty: await store.listDocuments() });
      } catch (error) {
        logError("DELETE", error);
        return json({ komunikat: KNOWLEDGE_MESSAGES.deleteError }, 502);
      }
    },

    async POST(req: Request): Promise<Response> {
      if (!(await deps.getSession(req))) return json({ komunikat: KNOWLEDGE_MESSAGES.unauthorized }, 401);
      const body = await readBody(req);
      if (body === null) return json({ komunikat: KNOWLEDGE_MESSAGES.badRequest }, 400);
      const check = checkUploadInput(body);
      if (!check.ok) return json({ komunikat: check.komunikat }, 400);
      const replace = (body as { zastap?: unknown }).zastap === true;
      const mode: SplitMode = (body as { podzial?: unknown }).podzial === "kawalki" ? "kawalki" : "akapity";
      const store = await deps.getStore();
      if (!store) return json({ komunikat: KNOWLEDGE_MESSAGES.notConfigured }, 503);
      // Ten sam tytuł bez potwierdzenia – pytamy, zanim cokolwiek zrobimy.
      if (!replace) {
        try {
          if (await store.hasTitle(check.title)) return json({ komunikat: KNOWLEDGE_MESSAGES.exists, istnieje: true }, 409);
        } catch (error) {
          logError("POST", error);
          return json({ komunikat: stageErrorMessage("split") }, 502);
        }
      }

      // Postęp: każda linia odpowiedzi to jedno zdarzenie JSON (etap, gotowe albo błąd).
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: UploadEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          try {
            const saved = await store.saveDocument(check.title, check.content, {
              replace,
              mode,
              onStage: (etap) => send({ typ: "etap", etap }),
            });
            send({
              typ: "gotowe",
              komunikat: savedMessage(check.title, saved.count),
              fragmenty: saved.count,
              ...(saved.oldVersionLeft ? { ostrzezenie: OLD_VERSION_NOT_DELETED } : {}),
            });
          } catch (error) {
            logError("POST", error);
            const stage = error instanceof KnowledgeError ? error.stage : "save";
            const kind = error instanceof KnowledgeError ? error.kind : "db";
            const komunikat =
              kind === "exists"
                ? KNOWLEDGE_MESSAGES.exists
                : stageErrorMessage(stage, kind === "embedding-config" ? EMBEDDING_NOT_CONFIGURED_DETAILS : undefined);
            send({ typ: "blad", etap: stage, komunikat });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { status: 200, headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8" } });
    },
  };
}
