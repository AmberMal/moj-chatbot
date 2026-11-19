// Testy lekcji 6, Warsztat 2 (Minimum, kroki A i B): podział, zapis dokumentu i embeddingi – BEZ Supabase i BEZ OpenRouter.
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-knowledge.mjs
import { readFileSync } from "node:fs";
import {
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_MESSAGES,
  MAX_CHUNK_CHARS,
  MAX_CONTENT_CHARS,
  checkUploadInput,
  createKnowledgeStore,
  KnowledgeError,
  createUploadApi,
  savedMessage,
  splitIntoChunks,
} from "../lib/amber-knowledge.ts";

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.log("NIE:", name);
  }
}

// --- podział: tekst „Cennik 2026” z lekcji (5 akapitów) ---
const cennik = [
  "Kwantowy Borsuk buduje agentów AI dla małych firm z Polski. Oferujemy trzy pakiety: Start, Zespół i Firma. Wszystkie ceny w tym cenniku są cenami netto i obowiązują od 1 stycznia 2026 roku.",
  "Pakiet Start kosztuje 490 zł netto miesięcznie. Obejmuje jednego agenta, do 1000 rozmów w miesiącu i jedną bazę wiedzy do 20 dokumentów. To nasz najmniejszy pakiet, przeznaczony dla jednoosobowych firm.",
  "Pakiet Zespół kosztuje 1290 zł netto miesięcznie. Obejmuje trzech agentów, do 5000 rozmów w miesiącu i wsparcie e-mail w dni robocze, z odpowiedzią w ciągu 24 godzin.",
  "Cena pakietu Firma jest ustalana indywidualnie po rozmowie z doradcą. Pakiet obejmuje dowolną liczbę agentów, własne integracje i opiekuna klienta.",
  "Umowę można wypowiedzieć z miesięcznym okresem wypowiedzenia. Płatność odbywa się przelewem na podstawie faktury, w terminie 14 dni. Przy płatności za cały rok z góry udzielamy 10% rabatu.",
];
const cennikChunks = splitIntoChunks(cennik.join("\n\n"));
check("cennik: 5 fragmentów", cennikChunks.length === 5);
check("cennik: fragmenty = akapity", cennikChunks.every((c, i) => c === cennik[i]));
check("cennik z \\r\\n: 5 fragmentów", splitIntoChunks(cennik.join("\r\n\r\n")).length === 5);
check("pusta linia ze spacjami też dzieli", splitIntoChunks("Ala.\n   \nOla.").length === 2);
check("kilka pustych linii = jeden podział", splitIntoChunks("Ala.\n\n\n\nOla.").length === 2);
check("pojedynczy enter nie dzieli", splitIntoChunks("Ala ma kota.\nOla ma psa.").length === 1);
check("krótkie akapity nie są łączone", splitIntoChunks("A.\n\nB.\n\nC.").length === 3);
check("pusty tekst = 0 fragmentów", splitIntoChunks("  \n\n  ").length === 0);
check("brzegi przycięte", splitIntoChunks("  Ala.  \n\n  Ola. ")[1] === "Ola.");

// --- długi akapit: podział na granicy zdania ---
const sentence = "To jest zdanie testowe numer jeden, które ma dość dużo słów w środku."; // ~70 znaków
const long = Array.from({ length: 30 }, () => sentence).join(" ");
check("długi akapit > 800", long.length > MAX_CHUNK_CHARS);
const longChunks = splitIntoChunks(long);
check("długi akapit: kilka fragmentów", longChunks.length >= 2);
check("długi akapit: każdy ≤ 800", longChunks.every((c) => c.length <= MAX_CHUNK_CHARS));
check("długi akapit: każdy kończy się na końcu zdania", longChunks.every((c) => c.endsWith(".")));
check("długi akapit: nic nie zginęło", longChunks.join(" ") === long);
check("akapit dokładnie 800 – jeden fragment", splitIntoChunks("a".repeat(799) + ".").length === 1);
const mixed = `Krótki akapit.\n\n${long}\n\nKoniec.`;
const mixedChunks = splitIntoChunks(mixed);
check("mieszany: pierwszy i ostatni bez zmian", mixedChunks[0] === "Krótki akapit." && mixedChunks.at(-1) === "Koniec.");
check("mieszany: liczba", mixedChunks.length === longChunks.length + 2);
const qa = Array.from({ length: 20 }, (_, i) => `Czy pytanie ${i} jest ważne? Tak! To jest odpowiedź numer ${i}…`).join(" ");
const qaChunks = splitIntoChunks(qa);
check("? ! … też kończą zdanie", qaChunks.every((c) => c.length <= MAX_CHUNK_CHARS && /[.?!…]$/.test(c)));
const giant = "słowo ".repeat(300).trim(); // jedno „zdanie” bez kropki > 800
const giantChunks = splitIntoChunks(giant);
check("zdanie > 800: tnie na słowach", giantChunks.length >= 2 && giantChunks.every((c) => c.length <= MAX_CHUNK_CHARS));
check("zdanie > 800: nie tnie słowa", giantChunks.every((c) => c.split(" ").every((w) => w === "słowo")));

// --- sprawdzanie formularza ---
check("pusty tytuł", checkUploadInput({ tytul: "  ", tresc: "x" }).komunikat === KNOWLEDGE_MESSAGES.emptyTitle);
check("pusta treść", checkUploadInput({ tytul: "T", tresc: " \n " }).komunikat === KNOWLEDGE_MESSAGES.emptyContent);
check("za długa treść", checkUploadInput({ tytul: "T", tresc: "a".repeat(MAX_CONTENT_CHARS + 1) }).komunikat === KNOWLEDGE_MESSAGES.contentTooLong);
check("20 000 znaków OK", checkUploadInput({ tytul: "T", tresc: "a".repeat(MAX_CONTENT_CHARS) }).ok === true);
check("za długi tytuł", checkUploadInput({ tytul: "a".repeat(201), tresc: "x" }).komunikat === KNOWLEDGE_MESSAGES.titleTooLong);
check("zły typ", checkUploadInput({ tytul: 1, tresc: "x" }).ok === false && checkUploadInput(null).ok === false && checkUploadInput([]).ok === false);
const ok = checkUploadInput({ tytul: " Cennik 2026 ", tresc: " A\r\n\r\nB " });
check("poprawne dane przycięte", ok.ok && ok.title === "Cennik 2026" && ok.content === "A\n\nB");
check("komunikat po zapisie", savedMessage("Cennik 2026", 5) === "Zapisano dokument „Cennik 2026”: 5 fragmentów");

// --- zapis (atrapa bazy i atrapa modelu embeddingów) ---
function fakeDb({ failChunks = false, old = [] } = {}) {
  const state = { docs: [], chunks: [], deleted: [], updated: [], old: old.map((o) => ({ ...o })) };
  let nextId = 1;
  return {
    state,
    async insertDocument(title) {
      const id = nextId++;
      state.docs.push({ id, title });
      return id;
    },
    async insertChunks(rows) {
      if (failChunks) throw new Error("awaria");
      state.chunks.push(...rows);
    },
    async deleteDocument(id) {
      state.deleted.push(id);
      state.docs = state.docs.filter((d) => d.id !== id);
    },
    async findChunksWithoutEmbedding(limit) {
      return state.old.filter((o) => o.embedding == null).slice(0, limit).map(({ id, content }) => ({ id, content }));
    },
    async updateEmbedding(id, embedding) {
      state.updated.push(id);
      const row = state.old.find((o) => o.id === id);
      if (row) row.embedding = embedding;
    },
  };
}
const vec = (n) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => n);
function fakeEmbed({ fail = false, short = false } = {}) {
  const calls = [];
  const fn = async (values) => {
    calls.push(values);
    if (fail) throw new Error("model niedostępny");
    return values.map((_, i) => (short ? [1, 2, 3] : vec(i)));
  };
  fn.calls = calls;
  return fn;
}
const embed = fakeEmbed();
const db = fakeDb();
const saved = await createKnowledgeStore(db, embed).saveDocument("Cennik 2026", cennik.join("\n\n"));
check("zapis: liczba fragmentów", saved.count === 5 && db.state.chunks.length === 5);
check("zapis: document_id i kolejność", db.state.chunks.every((c, i) => c.document_id === saved.id && c.chunk_index === i));
check("zapis: jedno wywołanie embedMany", embed.calls.length === 1 && embed.calls[0].length === 5);
check("zapis: embedding przy każdym fragmencie", db.state.chunks.every((c, i) => c.embedding.length === EMBEDDING_DIMENSIONS && c.embedding[0] === i));
check("zapis: embedding pasuje do treści", embed.calls[0].every((v, i) => v === db.state.chunks[i].content));

// uzupełnianie starych fragmentów (np. cennik z kroku A) – w tym samym jednym wywołaniu
const oldRows = [1, 2, 3, 4, 5].map((id) => ({ id, content: `stary ${id}`, embedding: null }));
oldRows.push({ id: 6, content: "ma już", embedding: vec(9) });
const embed2 = fakeEmbed();
const db2 = fakeDb({ old: oldRows });
const saved2 = await createKnowledgeStore(db2, embed2).saveDocument("FAQ", "P1?\n\nP2?");
check("backfill: jedno wywołanie", embed2.calls.length === 1 && embed2.calls[0].length === 7);
check("backfill: nowe najpierw, potem stare", embed2.calls[0][0] === "P1?" && embed2.calls[0][2] === "stary 1");
check("backfill: 5 uzupełnionych", saved2.backfilled === 5 && db2.state.updated.join() === "1,2,3,4,5");
check("backfill: wszystkie mają embedding", db2.state.old.every((o) => Array.isArray(o.embedding) && o.embedding.length === EMBEDDING_DIMENSIONS));
check("backfill: właściwe wektory", db2.state.old[0].embedding[0] === 2 && db2.state.old[4].embedding[0] === 6);
check("backfill: nie rusza wypełnionych", !db2.state.updated.includes(6) && db2.state.old[5].embedding[0] === 9);

// błędy
async function failing(store, title = "T", text = "A\n\nB") {
  try {
    await store.saveDocument(title, text);
    return null;
  } catch (error) {
    return error;
  }
}
const badDb = fakeDb({ failChunks: true });
const e1 = await failing(createKnowledgeStore(badDb, fakeEmbed()));
check("błąd fragmentów: wyjątek", e1 !== null);
check("błąd fragmentów: niedokończony dokument usunięty", badDb.state.docs.length === 0 && badDb.state.deleted.length === 1);
const embFailDb = fakeDb({ old: [{ id: 1, content: "x", embedding: null }] });
const e2 = await failing(createKnowledgeStore(embFailDb, fakeEmbed({ fail: true })));
check("błąd embeddingów: etap embedding", e2 instanceof KnowledgeError && e2.stage === "embedding");
check("błąd embeddingów: brak dokumentu i fragmentów", embFailDb.state.docs.length === 0 && embFailDb.state.chunks.length === 0);
check("błąd embeddingów: stare nieruszone", embFailDb.state.updated.length === 0);
const shortDb = fakeDb();
const e3 = await failing(createKnowledgeStore(shortDb, fakeEmbed({ short: true })));
check("zła długość wektora: błąd", e3 instanceof KnowledgeError && e3.stage === "embedding" && shortDb.state.docs.length === 0);
const missingDb = fakeDb();
const e4 = await failing(createKnowledgeStore(missingDb, async (values) => values.slice(1).map(() => vec(0))));
check("brak części embeddingów: błąd", e4 instanceof KnowledgeError && missingDb.state.docs.length === 0);
const noModelDb = fakeDb();
const e5 = await failing(createKnowledgeStore(noModelDb, null));
check("brak modelu: etap embedding-config", e5 instanceof KnowledgeError && e5.stage === "embedding-config" && noModelDb.state.docs.length === 0);

// --- endpoint ---
const post = (body, raw) =>
  new Request("http://localhost/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body) });
let storeTouched = false;
const noSessionEmbed = fakeEmbed();
const noSession = createUploadApi({ getSession: () => null, getStore: () => ((storeTouched = true), createKnowledgeStore(fakeDb(), noSessionEmbed)) });
const r401 = await noSession.POST(post({ tytul: "T", tresc: "x" }));
check("bez sesji: 401", r401.status === 401);
check("bez sesji: baza i model nietknięte", storeTouched === false && noSessionEmbed.calls.length === 0);
check("bez sesji: komunikat", (await r401.json()).komunikat === KNOWLEDGE_MESSAGES.unauthorized);
const apiDb = fakeDb();
const api = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(apiDb, fakeEmbed()) });
const r200 = await api.POST(post({ tytul: "Cennik 2026", tresc: cennik.join("\n\n") }));
const b200 = await r200.json();
check("zapis: 200", r200.status === 200);
check("zapis: komunikat", b200.komunikat === "Zapisano dokument „Cennik 2026”: 5 fragmentów" && b200.fragmenty === 5);
check("zapis: no-store", r200.headers.get("Cache-Control") === "no-store");
check("pusty tytuł: 400", (await api.POST(post({ tytul: "", tresc: "x" }))).status === 400);
check("zły JSON: 400", (await api.POST(post(null, "{nie json"))).status === 400);
const notConfigured = createUploadApi({ getSession: () => ({}), getStore: () => null });
check("brak Supabase: 503", (await notConfigured.POST(post({ tytul: "T", tresc: "x" }))).status === 503);
const origError = console.error;
console.error = () => {};
const failApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb({ failChunks: true }), fakeEmbed()) });
const r502 = await failApi.POST(post({ tytul: "T", tresc: "x" }));
const embApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb(), fakeEmbed({ fail: true })) });
const rEmb = await embApi.POST(post({ tytul: "T", tresc: "x" }));
const noModelApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb(), null) });
const rNoModel = await noModelApi.POST(post({ tytul: "T", tresc: "x" }));
console.error = origError;
const b502 = await r502.json();
check("błąd bazy: 502 i komunikat po polsku", r502.status === 502 && b502.komunikat === KNOWLEDGE_MESSAGES.saveError);
check("błąd bazy: bez „Zapisano”", !String(b502.komunikat).startsWith("Zapisano"));
const bEmb = await rEmb.json();
check("błąd embeddingów: 502 i komunikat", rEmb.status === 502 && bEmb.komunikat === KNOWLEDGE_MESSAGES.embeddingError);
check("błąd embeddingów: bez „Zapisano”", !String(bEmb.komunikat).includes("Zapisano dokument"));
check("brak modelu: 503 i komunikat", rNoModel.status === 503 && (await rNoModel.json()).komunikat === KNOWLEDGE_MESSAGES.embeddingNotConfigured);

// --- pliki: sesja przed bazą, klucz tylko na serwerze, link w czacie ---
const route = readFileSync("app/api/upload/route.ts", "utf8");
check("route: sprawdza sesję", route.includes("isSessionValid") && route.includes("getSession"));
const page = readFileSync("app/upload/page.tsx", "utf8");
check("strona: bez sesji formularz hasła", page.includes("LoginForm") && page.includes("{loggedIn && <UploadForm />}"));
const form = readFileSync("app/upload/upload-form.tsx", "utf8");
check("formularz: pola i przycisk", form.includes(">\n        Tytuł") && form.includes(">\n        Treść") && form.includes("Dodaj do bazy wiedzy"));
check("formularz: nie importuje supabase", !form.includes("supabase"));
const knowledge = readFileSync("lib/amber-knowledge.ts", "utf8");
check("lib: tylko typ z supabase-js", knowledge.includes('import type { SupabaseClient }') && !knowledge.includes("process.env"));
const model = readFileSync("lib/model.ts", "utf8");
check("model: embedMany i OPENROUTER_EMBEDDING_MODEL", model.includes("embedMany") && model.includes("OPENROUTER_EMBEDDING_MODEL"));
const supa = readFileSync("lib/supabase.ts", "utf8");
check("supabase: store z embedderem", supa.includes("getEmbedder()"));
const chat = readFileSync("app/chat.tsx", "utf8");
check("czat: link Baza wiedzy", chat.includes('href="/upload"') && chat.includes("Baza wiedzy"));

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
if (failed) process.exit(1);
