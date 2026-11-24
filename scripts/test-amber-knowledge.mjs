// Testy lekcji 6, Warsztat 2 (Minimum A i B + Standard): podział, zapis, embeddingi, lista, zastępowanie, usuwanie
// – BEZ Supabase i BEZ OpenRouter.
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-knowledge.mjs
import { readFileSync } from "node:fs";
import {
  EMBEDDING_DIMENSIONS,
  FIXED_CHUNK_CHARS,
  FIXED_CHUNK_OVERLAP,
  KNOWLEDGE_MESSAGES,
  KnowledgeError,
  MAX_CHUNK_CHARS,
  MAX_CONTENT_CHARS,
  OLD_VERSION_NOT_DELETED,
  STAGE_PROGRESS,
  checkUploadInput,
  createKnowledgeStore,
  createUploadApi,
  deleteQuestion,
  formatAddedAt,
  interruptedMessage,
  replaceQuestion,
  savedMessage,
  splitIntoChunks,
  splitIntoFixedChunks,
  splitText,
  stageErrorMessage,
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

// --- Dla szybkich: „stałe kawałki” po 300 znaków z zakładką 50 ---
// tekst testowy: punkty regulaminu (bez zależności od plików w baza-wiedzy/)
const regulamin = Array.from({ length: 9 }, (_, i) => `${i + 1}. Punkt regulaminu numer ${i + 1} opisuje jedną zasadę umowy serwisowej i ma kilka zdań. Klient zostaje o niej poinformowany e-mailem.`).join("\n\n");
const fixed = splitIntoFixedChunks(regulamin);
check("kawałki: każdy ≤ 300", fixed.every((c) => c.length <= FIXED_CHUNK_CHARS));
check("kawałki: kilka kawałków", fixed.length >= Math.floor(regulamin.trim().length / (FIXED_CHUNK_CHARS - FIXED_CHUNK_OVERLAP)));
const plain = "abcdefghij".repeat(100); // 1000 znaków bez spacji
const plainChunks = splitIntoFixedChunks(plain);
check("kawałki: start co 250 znaków", plainChunks.length === 4 && plainChunks[1] === plain.slice(250, 550) && plainChunks[3] === plain.slice(750));
check("kawałki: zakładka 50 znaków", plainChunks[0].slice(-FIXED_CHUNK_OVERLAP) === plainChunks[1].slice(0, FIXED_CHUNK_OVERLAP));
check("kawałki: nic nie zginęło", plainChunks[0] + plainChunks.slice(1).map((c) => c.slice(FIXED_CHUNK_OVERLAP)).join("") === plain);
check("kawałki: krótki tekst = 1", splitIntoFixedChunks("Krótki tekst.").length === 1);
check("kawałki: dokładnie 300 = 1", splitIntoFixedChunks("a".repeat(300)).length === 1);
check("kawałki: 301 = 2", splitIntoFixedChunks("a".repeat(301)).length === 2);
check("kawałki: pusty = 0", splitIntoFixedChunks("   ").length === 0);
check("splitText: domyślnie akapity", splitText(regulamin, "akapity").length === splitIntoChunks(regulamin).length);
check("splitText: kawałki", splitText(regulamin, "kawalki").length === fixed.length);

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

// --- atrapa bazy i atrapa modelu embeddingów ---
// Atrapa trzyma dokumenty i fragmenty razem (jak documents + chunks z on delete cascade).
function fakeDb({ failChunks = false, failDeleteIds = [], failList = false } = {}) {
  const state = { docs: [], chunks: [], deleted: [], updated: [], nextDoc: 1, nextChunk: 1 };
  return {
    state,
    addOld(title, contents, withEmbedding = false) {
      const id = state.nextDoc++;
      state.docs.push({ id, title, created_at: `2026-11-19T10:0${id}:00Z` });
      contents.forEach((content, i) =>
        state.chunks.push({ id: state.nextChunk++, document_id: id, chunk_index: i, content, embedding: withEmbedding ? vec(9) : null }),
      );
      return id;
    },
    async insertDocument(title) {
      const id = state.nextDoc++;
      state.docs.push({ id, title, created_at: "2026-11-19T19:40:00Z" });
      return id;
    },
    async insertChunks(rows) {
      if (failChunks) throw new Error("awaria");
      for (const row of rows) state.chunks.push({ id: state.nextChunk++, ...row });
    },
    async deleteDocument(id) {
      if (failDeleteIds.includes(id)) throw new Error("awaria usuwania");
      state.deleted.push(id);
      state.docs = state.docs.filter((d) => d.id !== id);
      state.chunks = state.chunks.filter((c) => c.document_id !== id);
    },
    async findChunksWithoutEmbedding(limit) {
      return state.chunks
        .filter((c) => c.embedding == null)
        .slice(0, limit)
        .map(({ id, document_id, content }) => ({ id, document_id, content }));
    },
    async updateEmbedding(id, embedding) {
      state.updated.push(id);
      const row = state.chunks.find((c) => c.id === id);
      if (row) row.embedding = embedding;
    },
    async listDocuments() {
      if (failList) throw new Error("awaria listy");
      return [...state.docs]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((d) => ({ id: d.id, title: d.title, createdAt: d.created_at, chunks: state.chunks.filter((c) => c.document_id === d.id).length }));
    },
    async findDocumentIdsByTitle(title) {
      return state.docs.filter((d) => d.title === title).map((d) => d.id);
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

// --- zapis z embeddingami (Minimum B) ---
const embed = fakeEmbed();
const db = fakeDb();
const stages = [];
const saved = await createKnowledgeStore(db, embed).saveDocument("Cennik 2026", cennik.join("\n\n"), { onStage: (s) => stages.push(s) });
check("zapis: liczba fragmentów", saved.count === 5 && db.state.chunks.length === 5);
check("zapis: document_id i kolejność", db.state.chunks.every((c, i) => c.document_id === saved.id && c.chunk_index === i));
check("zapis: jedno wywołanie embedMany", embed.calls.length === 1 && embed.calls[0].length === 5);
check("zapis: embedding przy każdym fragmencie", db.state.chunks.every((c, i) => c.embedding.length === EMBEDDING_DIMENSIONS && c.embedding[0] === i));
check("zapis: embedding pasuje do treści", embed.calls[0].every((v, i) => v === db.state.chunks[i].content));
check("etapy: dzielę → embeddingi → zapisuję", stages.join(",") === "split,embed,save");

// uzupełnianie starych fragmentów (cennik z kroku A) – w tym samym jednym wywołaniu
const embed2 = fakeEmbed();
const db2 = fakeDb();
db2.addOld("Cennik 2026", ["stary 1", "stary 2", "stary 3", "stary 4", "stary 5"]);
db2.addOld("Inny", ["ma już"], true);
const saved2 = await createKnowledgeStore(db2, embed2).saveDocument("FAQ", "P1?\n\nP2?");
check("backfill: jedno wywołanie", embed2.calls.length === 1 && embed2.calls[0].length === 7);
check("backfill: nowe najpierw, potem stare", embed2.calls[0][0] === "P1?" && embed2.calls[0][2] === "stary 1");
check("backfill: 5 uzupełnionych", saved2.backfilled === 5 && db2.state.updated.join() === "1,2,3,4,5");
check("backfill: wszystkie mają embedding", db2.state.chunks.every((c) => Array.isArray(c.embedding) && c.embedding.length === EMBEDDING_DIMENSIONS));
check("backfill: właściwe wektory", db2.state.chunks[0].embedding[0] === 2 && db2.state.chunks[4].embedding[0] === 6);
check("backfill: nie rusza wypełnionych", !db2.state.updated.includes(6) && db2.state.chunks[5].embedding[0] === 9);

// --- błędy ---
async function failing(store, title = "T", text = "A\n\nB", options) {
  try {
    await store.saveDocument(title, text, options);
    return null;
  } catch (error) {
    return error;
  }
}
const badDb = fakeDb({ failChunks: true });
const e1 = await failing(createKnowledgeStore(badDb, fakeEmbed()));
check("błąd fragmentów: etap zapis", e1 instanceof KnowledgeError && e1.stage === "save" && e1.kind === "db");
check("błąd fragmentów: niedokończony dokument usunięty", badDb.state.docs.length === 0 && badDb.state.deleted.length === 1);
const embFailDb = fakeDb();
embFailDb.addOld("X", ["x"]);
const e2 = await failing(createKnowledgeStore(embFailDb, fakeEmbed({ fail: true })));
check("błąd embeddingów: etap embed", e2 instanceof KnowledgeError && e2.kind === "embedding" && e2.stage === "embed");
check("błąd embeddingów: brak nowego dokumentu", embFailDb.state.docs.length === 1 && embFailDb.state.chunks.length === 1);
check("błąd embeddingów: stare nieruszone", embFailDb.state.updated.length === 0);
const shortDb = fakeDb();
const e3 = await failing(createKnowledgeStore(shortDb, fakeEmbed({ short: true })));
check("zła długość wektora: błąd", e3 instanceof KnowledgeError && e3.stage === "embed" && shortDb.state.docs.length === 0);
const missingDb = fakeDb();
const e4 = await failing(createKnowledgeStore(missingDb, async (values) => values.slice(1).map(() => vec(0))));
check("brak części embeddingów: błąd", e4 instanceof KnowledgeError && missingDb.state.docs.length === 0);
const noModelDb = fakeDb();
const e5 = await failing(createKnowledgeStore(noModelDb, null));
check("brak modelu: embedding-config", e5 instanceof KnowledgeError && e5.kind === "embedding-config" && e5.stage === "embed" && noModelDb.state.docs.length === 0);

// --- Standard: lista, zastępowanie, usuwanie (store) ---
const repDb = fakeDb();
const repStore = createKnowledgeStore(repDb, fakeEmbed());
await repStore.saveDocument("Cennik 2026", cennik.join("\n\n"));
await repStore.saveDocument("FAQ", "P1?\n\nP2?");
const list1 = await repStore.listDocuments();
check("lista: 2 dokumenty z liczbą fragmentów", list1.length === 2 && list1.find((d) => d.title === "Cennik 2026").chunks === 5);
check("lista: tytuł, data, liczba", list1.every((d) => typeof d.title === "string" && typeof d.createdAt === "string" && typeof d.chunks === "number"));
const e6 = await failing(repStore, "Cennik 2026", "nowa treść");
check("ten sam tytuł bez potwierdzenia: exists", e6 instanceof KnowledgeError && e6.kind === "exists");
check("ten sam tytuł bez potwierdzenia: nic nie zmienione", repDb.state.docs.length === 2 && repDb.state.chunks.length === 7);
const cennik540 = cennik.join("\n\n").replace("490 zł", "540 zł");
const modeDb = fakeDb();
const modeStore = createKnowledgeStore(modeDb, fakeEmbed());
const savedKaw = await modeStore.saveDocument("Regulamin (kawałki)", regulamin, { mode: "kawalki" });
check("zapis kawałkami: liczba", savedKaw.count === fixed.length && modeDb.state.chunks.every((c, i) => c.content === fixed[i]));
const savedAkap = await modeStore.saveDocument("Regulamin", regulamin);
check("zapis bez wyboru: akapity", savedAkap.count === splitIntoChunks(regulamin).length);
const rep = await repStore.saveDocument("Cennik 2026", cennik540, { replace: true });
const list2 = await repStore.listDocuments();
check("zastąpienie: nadal jeden cennik", list2.filter((d) => d.title === "Cennik 2026").length === 1 && list2.length === 2);
check("zastąpienie: nie ma 490 zł", !repDb.state.chunks.some((c) => c.content.includes("490 zł")));
check("zastąpienie: jest 540 zł", repDb.state.chunks.some((c) => c.content.includes("540 zł")));
check("zastąpienie: tylko nowe fragmenty", repDb.state.chunks.filter((c) => c.document_id === rep.id).length === 5 && repDb.state.chunks.length === 7);
check("zastąpienie: wynik", rep.replaced === 1 && rep.oldVersionLeft === false);
// zastąpienie z błędem embeddingów – stara wersja zostaje
const keepDb = fakeDb();
const keepId = keepDb.addOld("Cennik 2026", ["490 zł"], true);
const e7 = await failing(createKnowledgeStore(keepDb, fakeEmbed({ fail: true })), "Cennik 2026", "540 zł", { replace: true });
check("zastąpienie, błąd: stara wersja zostaje", e7 instanceof KnowledgeError && keepDb.state.docs.length === 1 && keepDb.state.docs[0].id === keepId);
const keepDb2 = fakeDb({ failChunks: true });
keepDb2.addOld("Cennik 2026", ["490 zł"], true);
await failing(createKnowledgeStore(keepDb2, fakeEmbed()), "Cennik 2026", "540 zł", { replace: true });
check("zastąpienie, błąd zapisu: stara zostaje, nowej nie ma", keepDb2.state.docs.length === 1 && keepDb2.state.chunks[0].content === "490 zł");
// stare fragmenty bez embeddingu z zastępowanego dokumentu nie są uzupełniane
const skipDb = fakeDb();
skipDb.addOld("Cennik 2026", ["stary bez wektora"]);
const skipEmbed = fakeEmbed();
await createKnowledgeStore(skipDb, skipEmbed).saveDocument("Cennik 2026", "nowy", { replace: true });
check("zastąpienie: nie liczy embeddingów starej wersji", skipEmbed.calls[0].length === 1 && skipDb.state.updated.length === 0);
// nie udało się usunąć starej wersji – nowa zapisana, ostrzeżenie
const leftDb = fakeDb({ failDeleteIds: [1] });
leftDb.addOld("Cennik 2026", ["490 zł"], true);
const origErr = console.error;
console.error = () => {};
const left = await createKnowledgeStore(leftDb, fakeEmbed()).saveDocument("Cennik 2026", "540 zł", { replace: true });
console.error = origErr;
check("stara wersja nieusunięta: ostrzeżenie", left.oldVersionLeft === true && leftDb.state.docs.length === 2);
// usuwanie
await repStore.deleteDocument(list2.find((d) => d.title === "FAQ").id);
check("usuń: dokument i jego fragmenty znikają", (await repStore.listDocuments()).length === 1 && repDb.state.chunks.length === 5);

// --- komunikaty ---
check("postęp: trzy komunikaty", STAGE_PROGRESS.split === "Dzielę tekst…" && STAGE_PROGRESS.embed === "Tworzę embeddingi…" && STAGE_PROGRESS.save === "Zapisuję…");
check("błąd: etap i co zrobić", stageErrorMessage("embed").includes("tworzenie embeddingów") && stageErrorMessage("embed").includes("Co możesz zrobić"));
check("błąd zapisu: etap", stageErrorMessage("save").includes("zapis w bazie") && stageErrorMessage("split").includes("dzielenie tekstu"));
check("przerwane: etap", interruptedMessage("save").includes("zapis w bazie") && interruptedMessage(null).includes("Co możesz zrobić"));
check("pytanie o zastąpienie", replaceQuestion("FAQ").includes("„FAQ”") && replaceQuestion("FAQ").includes("Zastąpić"));
check("pytanie o usunięcie", deleteQuestion("FAQ", 5).includes("5 fragmentów") && deleteQuestion("FAQ", 5).includes("nie można cofnąć"));
check("data dodania po polsku", formatAddedAt("2026-11-19T19:40:00Z") === "19.11.2026, 19:40");
check("zła data: pusto", formatAddedAt("nie-data") === "");

// --- endpoint ---
const req = (method, body, raw) =>
  new Request("http://localhost/api/upload", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }),
  });
async function readEvents(response) {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
let storeTouched = false;
const noSessionEmbed = fakeEmbed();
const noSession = createUploadApi({ getSession: () => null, getStore: () => ((storeTouched = true), createKnowledgeStore(fakeDb(), noSessionEmbed)) });
for (const method of ["GET", "POST", "DELETE"]) {
  const r = await noSession[method](req(method, method === "DELETE" ? { id: 1 } : { tytul: "T", tresc: "x" }));
  check(`bez sesji ${method}: 401`, r.status === 401 && (await r.json()).komunikat === KNOWLEDGE_MESSAGES.unauthorized);
}
check("bez sesji: baza i model nietknięte", storeTouched === false && noSessionEmbed.calls.length === 0);

const apiDb = fakeDb();
const api = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(apiDb, fakeEmbed()) });
const r200 = await api.POST(req("POST", { tytul: "Cennik 2026", tresc: cennik.join("\n\n") }));
check("POST: strumień ndjson, no-store", r200.status === 200 && r200.headers.get("Content-Type").includes("ndjson") && r200.headers.get("Cache-Control") === "no-store");
const ev = await readEvents(r200);
check("POST: etapy po kolei", ev.slice(0, 3).map((e) => e.etap).join(",") === "split,embed,save" && ev.slice(0, 3).every((e) => e.typ === "etap"));
check("POST: gotowe z komunikatem", ev.at(-1).typ === "gotowe" && ev.at(-1).komunikat === "Zapisano dokument „Cennik 2026”: 5 fragmentów" && ev.at(-1).fragmenty === 5);
const modeApiDb = fakeDb();
const modeApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(modeApiDb, fakeEmbed()) });
const evKaw = await readEvents(await modeApi.POST(req("POST", { tytul: "Regulamin (kawałki)", tresc: regulamin, podzial: "kawalki" })));
check("POST podzial=kawalki", evKaw.at(-1).fragmenty === fixed.length);
const evDef = await readEvents(await modeApi.POST(req("POST", { tytul: "R2", tresc: regulamin, podzial: "coś innego" })));
check("POST nieznany podział: akapity", evDef.at(-1).fragmenty === splitIntoChunks(regulamin).length);
const rList = await api.GET(req("GET"));
const bList = await rList.json();
check("GET: lista", rList.status === 200 && bList.dokumenty.length === 1 && bList.dokumenty[0].chunks === 5);
const r409 = await api.POST(req("POST", { tytul: "Cennik 2026", tresc: "540 zł" }));
const b409 = await r409.json();
check("POST ten sam tytuł: 409 i pytanie", r409.status === 409 && b409.istnieje === true && b409.komunikat === KNOWLEDGE_MESSAGES.exists);
check("POST ten sam tytuł: nic nie zmienione", apiDb.state.docs.length === 1 && apiDb.state.chunks.length === 5);
const rRep = await api.POST(req("POST", { tytul: "Cennik 2026", tresc: cennik540, zastap: true }));
const evRep = await readEvents(rRep);
check("POST zastąp: gotowe", evRep.at(-1).typ === "gotowe" && !("ostrzezenie" in evRep.at(-1)));
check("POST zastąp: jeden cennik, bez 490 zł", apiDb.state.docs.length === 1 && !apiDb.state.chunks.some((c) => c.content.includes("490 zł")));
check("pusty tytuł: 400", (await api.POST(req("POST", { tytul: "", tresc: "x" }))).status === 400);
check("zły JSON: 400", (await api.POST(req("POST", null, "{nie json"))).status === 400);
const docId = apiDb.state.docs[0].id;
check("DELETE złe id: 400", (await api.DELETE(req("DELETE", { id: "1" }))).status === 400 && (await api.DELETE(req("DELETE", {}))).status === 400);
const rDel = await api.DELETE(req("DELETE", { id: docId }));
const bDel = await rDel.json();
check("DELETE: usunięto i nowa lista", rDel.status === 200 && bDel.komunikat === KNOWLEDGE_MESSAGES.deleted && bDel.dokumenty.length === 0);
check("DELETE: fragmenty znikają", apiDb.state.chunks.length === 0);
const notConfigured = createUploadApi({ getSession: () => ({}), getStore: () => null });
check("brak Supabase: 503", (await notConfigured.POST(req("POST", { tytul: "T", tresc: "x" }))).status === 503 && (await notConfigured.GET(req("GET"))).status === 503);

console.error = () => {};
const failApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb({ failChunks: true }), fakeEmbed()) });
const evFail = await readEvents(await failApi.POST(req("POST", { tytul: "T", tresc: "x" })));
const embApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb(), fakeEmbed({ fail: true })) });
const evEmb = await readEvents(await embApi.POST(req("POST", { tytul: "T", tresc: "x" })));
const noModelApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb(), null) });
const evNoModel = await readEvents(await noModelApi.POST(req("POST", { tytul: "T", tresc: "x" })));
const listFailApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(fakeDb({ failList: true }), fakeEmbed()) });
const rListFail = await listFailApi.GET(req("GET"));
const leftDb2 = fakeDb({ failDeleteIds: [1] });
leftDb2.addOld("Cennik 2026", ["490 zł"], true);
const leftApi = createUploadApi({ getSession: () => ({}), getStore: () => createKnowledgeStore(leftDb2, fakeEmbed()) });
const evLeft = await readEvents(await leftApi.POST(req("POST", { tytul: "Cennik 2026", tresc: "540 zł", zastap: true })));
console.error = origErr;
check("błąd zapisu: etap zapis i rada", evFail.at(-1).typ === "blad" && evFail.at(-1).etap === "save" && evFail.at(-1).komunikat === stageErrorMessage("save"));
check("błąd zapisu: bez „Zapisano dokument”", !evFail.some((e) => e.typ === "gotowe"));
check("błąd embeddingów: etap i rada", evEmb.at(-1).typ === "blad" && evEmb.at(-1).etap === "embed" && evEmb.at(-1).komunikat.includes("Co możesz zrobić"));
check("błąd embeddingów: bez „Zapisano dokument”", !evEmb.some((e) => e.typ === "gotowe"));
check("brak modelu: komunikat o zmiennej", evNoModel.at(-1).typ === "blad" && evNoModel.at(-1).komunikat.includes("OPENROUTER_EMBEDDING_MODEL"));
check("lista, błąd: 502", rListFail.status === 502 && (await rListFail.json()).komunikat === KNOWLEDGE_MESSAGES.listError);
check("stara wersja nieusunięta: ostrzeżenie w odpowiedzi", evLeft.at(-1).typ === "gotowe" && evLeft.at(-1).ostrzezenie === OLD_VERSION_NOT_DELETED);

// --- pliki: sesja przed bazą, klucz tylko na serwerze, link w czacie ---
const route = readFileSync("app/api/upload/route.ts", "utf8");
check("route: sprawdza zalogowaną osobę", route.includes("getSession: () => getApiSession()"));
check("route: GET, POST, DELETE", ["GET", "POST", "DELETE"].every((m) => route.includes(`export async function ${m}`)));
const page = readFileSync("app/upload/page.tsx", "utf8");
check("strona: bez logowania przekierowanie na /login", page.includes("await getCurrentUser()") && page.includes('if (!user) redirect(loginUrl(') && page.indexOf("getCurrentUser()") < page.indexOf("getKnowledgeStore()"));
check("strona: lista dopiero po sesji", page.indexOf("if (loggedIn)") < page.indexOf("listDocuments()"));
const form = readFileSync("app/upload/upload-form.tsx", "utf8");
check("formularz: pola i przycisk", />\s*Tytuł\s*</.test(form) && />\s*Treść\s*</.test(form) && form.includes("Dodaj do bazy wiedzy"));
check("formularz: nie importuje supabase", !form.includes("supabase"));
check("formularz: przycisk zablokowany w trakcie", form.includes("disabled={busy}") && form.includes("if (busy) return"));
check("formularz: potwierdzenia", form.includes("replaceQuestion(") && form.includes("deleteQuestion(") && form.includes("window.confirm"));
check("formularz: wybór podziału, domyślnie akapity", form.includes('useState<SplitMode>("akapity")') && form.includes("podzial: mode") && form.includes("SPLIT_MODES"));
check("formularz: lista i Usuń", form.includes("Dokumenty w bazie wiedzy") && form.includes("Usuń") && form.includes("formatAddedAt("));
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
