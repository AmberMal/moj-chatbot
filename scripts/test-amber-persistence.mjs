// Testy lekcji 5, Warsztat 2 (Minimum): trwałe rozmowy w Supabase – BEZ Supabase i BEZ OpenRouter.
// Sztuczna baza (tablice w pamięci) i sztuczne modele z biblioteki "ai/test".
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-persistence.mjs

import { readFileSync } from "node:fs";
import { readUIMessageStream } from "ai";
import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import { createAgentHandler, parseConversationId } from "../lib/amber-agent.ts";
import { SESSION_COOKIE, createSessionToken, isSessionValid, readCookie } from "../lib/auth.ts";
import { AMBER_ANALYZE_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS } from "../lib/amber-instructions.ts";
import { generateAmberOutput } from "../lib/amber-output.ts";
import { IMAGE_MODEL_ID, createImageTool } from "../lib/amber-image.ts";
import {
  CONVERSATION_MESSAGES,
  IMAGE_NOTE,
  MAX_LOADED_MESSAGES,
  MAX_STORED_USER_CHARS,
  assistantTextForStorage,
  conversationTitle,
  createConversationStore,
  createLatestConversationHandler,
  createSupabaseConversationDb,
  toSignedUIMessages,
  unansweredUserTurns,
  userTextForStorage,
} from "../lib/amber-conversations.ts";
import {
  HISTORY_LOAD_ERROR,
  LATEST_CONVERSATION_API,
  prepareAgentMessages,
  readConversationId,
  readLatestConversation,
} from "../lib/amber-chat-client.ts";
import {
  MAX_HISTORY_MESSAGES,
  MAX_USER_MESSAGE_CHARS,
  checkChatHistory,
  deriveHistoryKey,
  sessionIdFromToken,
  signAgentChatTurn,
} from "../lib/amber-history.ts";

let passed = 0;
let failed = 0;
function check(name, condition, info = "") {
  condition ? passed++ : failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${info ? `  → ${info}` : ""}`);
}
const silence = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// Fikcyjna konfiguracja (tylko do testów).
const AUTH = { password: "test-haslo", secret: "test-secret-persist-".padEnd(64, "p") };
const TOKEN = createSessionToken(AUTH);
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const SESSION_ID = sessionIdFromToken(TOKEN);
const KEY = deriveHistoryKey(AUTH.secret);
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const stop = { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage };
const toolCallsFinish = { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage };
const textChunks = (t, id = "t1") => [{ type: "text-start", id }, { type: "text-delta", id, delta: t }, { type: "text-end", id }];
const streamOf = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });

function chatModel(steps) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = steps[Math.min(i, steps.length - 1)];
      i++;
      return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "google/gemini-3.8-flash", timestamp: new Date(0) }, ...chunks]) };
    },
  });
}
function imageModel() {
  return new MockImageModelV4({
    modelId: IMAGE_MODEL_ID,
    doGenerate: async () => ({ images: [PNG_1PX], warnings: [], response: { timestamp: new Date(0), modelId: IMAGE_MODEL_ID, headers: {} } }),
  });
}

// Sztuczna baza: tabele conversations i messages w pamięci.
function fakeDb({ failInsert = false } = {}) {
  const db = { conversations: [], messages: [], insertCalls: 0, calls: 0 };
  let nextConv = 1;
  let nextMsg = 1;
  db.api = {
    async conversationExists(id) { db.calls++; return db.conversations.some((c) => c.id === id); },
    async createConversation(title) { db.calls++; const id = nextConv++; db.conversations.push({ id, title }); return id; },
    async insertMessages(rows) {
      db.calls++;
      db.insertCalls++;
      if (failInsert) throw new Error("Supabase (zapis wiadomości): 42501 permission denied");
      for (const row of rows) db.messages.push({ id: nextMsg++, ...row });
    },
    async latestConversationId() { db.calls++; const last = db.messages[db.messages.length - 1]; return last ? last.conversation_id : null; },
    async loadMessages(conversationId, limit) {
      db.calls++;
      return db.messages.filter((m) => m.conversation_id === conversationId).slice(-limit).map(({ id, role, content }) => ({ id, role, content }));
    },
  };
  return db;
}

function handler({ model, store = null, counter = { models: 0 } }) {
  const h = createAgentHandler({
    getSession: (req) => {
      const token = readCookie(req, SESSION_COOKIE);
      return token && isSessionValid(token, AUTH) ? { secret: AUTH.secret, token } : null;
    },
    createModels: () => {
      counter.models++;
      return { model, tools: { generujObraz: createImageTool({ model: imageModel(), maxRetries: 0 }) } };
    },
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput,
    maxTextChars: MAX_USER_MESSAGE_CHARS,
    maxRetries: 0,
    now: () => new Date("2026-11-17T19:00:00Z"),
    log: () => {},
    conversations: () => store,
  });
  return { handle: h, counter };
}
const request = (body, cookie = COOKIE, signal) =>
  new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
async function readChat(response) {
  const raw = await response.text();
  const chunks = raw.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
  let message;
  for await (const m of readUIMessageStream({ stream: streamOf(chunks) })) message = m;
  return { chunks, message: { ...message, role: "assistant" } };
}
const user = (id, text) => ({ id, role: "user", parts: [{ type: "text", text }] });
const latestRequest = (cookie = COOKIE) => new Request(`http://localhost${LATEST_CONVERSATION_API}`, { headers: cookie ? { cookie } : {} });
function latestHandler(getStore) {
  return createLatestConversationHandler({
    getSession: (req) => {
      const token = readCookie(req, SESSION_COOKIE);
      return token && isSessionValid(token, AUTH) ? { secret: AUTH.secret, token } : null;
    },
    getStore,
    sign: (session, history) => signAgentChatTurn(deriveHistoryKey(session.secret), sessionIdFromToken(session.token), history, {}),
  });
}

// ---------------------------------------------------------------------------
console.log("\n=== 1. Tekst do zapisu: obrazy jako „[obraz]”, tytuł, limity ===");
{
  check("Zwykła wiadomość – sam tekst (bez spacji na brzegach)", userTextForStorage({ role: "user", text: "  Dzień dobry  " }) === "Dzień dobry");
  check("Wiadomość ze zdjęciem → tekst + „[obraz]” (bez danych zdjęcia)",
    userTextForStorage({ role: "user", text: "Co to za czujnik?", image: { mediaType: "image/png", base64: PNG_1PX } }) === `Co to za czujnik? ${IMAGE_NOTE}`);
  check("Samo zdjęcie → „[obraz]”", userTextForStorage({ role: "user", text: "", image: { mediaType: "image/png", base64: PNG_1PX } }) === IMAGE_NOTE);
  const long = userTextForStorage({ role: "user", text: "a".repeat(4000), image: { mediaType: "image/png", base64: PNG_1PX } });
  check("Długa wiadomość ze zdjęciem mieści się w limicie 4000 znaków (z dopiskiem)", long.length === MAX_STORED_USER_CHARS && long.endsWith(IMAGE_NOTE));
  check("Limit zapisu = limit historii serwera (4000)", MAX_STORED_USER_CHARS === MAX_USER_MESSAGE_CHARS);
  check("Odpowiedź z wygenerowanym obrazem → tekst + „[obraz]”", assistantTextForStorage("Oto plakat.", true) === `Oto plakat.\n\n${IMAGE_NOTE}`);
  check("Odpowiedź z samym obrazem → „[obraz]”", assistantTextForStorage("", true) === IMAGE_NOTE);
  check("Odpowiedź bez obrazu – bez dopisku", assistantTextForStorage("Dzień dobry!", false) === "Dzień dobry!");
  check("Tytuł = początek pierwszej wiadomości", conversationTitle("Ile kosztuje alarm?") === "Ile kosztuje alarm?");
  const title = conversationTitle("x ".repeat(100));
  check("Długi tytuł skrócony do 60 znaków z „…”", title.length === 60 && title.endsWith("…"));
  check("Pusty tytuł → „Nowa rozmowa”", conversationTitle("   ") === "Nowa rozmowa");
  const turns = [{ role: "user", text: "A" }, { role: "assistant", text: "B" }, { role: "user", text: "C (przerwane)" }, { role: "user", text: "D" }];
  check("Bez odpowiedzi = wszystkie wiadomości klienta po ostatniej odpowiedzi Amber",
    JSON.stringify(unansweredUserTurns(turns).map((t) => t.text)) === JSON.stringify(["C (przerwane)", "D"]));
}

console.log("\n=== 2. Zapis: raz, jednym poleceniem, w dobrej kolejności ===");
{
  const db = fakeDb();
  const store = createConversationStore(db.api);
  const id1 = await store.saveExchange({ conversationId: null, turns: [{ role: "user", text: "Ile kosztuje alarm?" }], replyText: "Od £666 + VAT.", generatedImage: false });
  check("Pierwsza wiadomość tworzy rozmowę z tytułem", id1 === 1 && db.conversations.length === 1 && db.conversations[0].title === "Ile kosztuje alarm?");
  check("Zapis: 2 wiersze (klient, Amber), jedno polecenie insert", db.messages.length === 2 && db.insertCalls === 1 &&
    db.messages[0].role === "user" && db.messages[1].role === "assistant" && db.messages[0].id < db.messages[1].id);
  const turns2 = [{ role: "user", text: "Ile kosztuje alarm?" }, { role: "assistant", text: "Od £666 + VAT." }, { role: "user", text: "A CCTV?" }];
  const id2 = await store.saveExchange({ conversationId: id1, turns: turns2, replyText: "Wycena po wizycie.", generatedImage: false });
  check("Kolejna wiadomość trafia do tej samej rozmowy (bez nowej rozmowy)", id2 === id1 && db.conversations.length === 1);
  check("Bez duplikatów: wcześniejsze wiadomości nie są zapisywane ponownie", db.messages.length === 4 && db.messages[2].content === "A CCTV?" && db.messages[3].content === "Wycena po wizycie.");
  const turns3 = [...turns2, { role: "assistant", text: "Wycena po wizycie." }, { role: "user", text: "Pytanie przerwane Stopem" }, { role: "user", text: "Nowe pytanie" }];
  await store.saveExchange({ conversationId: id1, turns: turns3, replyText: "Odpowiedź", generatedImage: false });
  check("Pytanie przerwane Stopem zapisuje się razem z kolejnym (kolejność zachowana)",
    JSON.stringify(db.messages.slice(4).map((m) => m.content)) === JSON.stringify(["Pytanie przerwane Stopem", "Nowe pytanie", "Odpowiedź"]));
  const id3 = await store.saveExchange({ conversationId: 999, turns: [{ role: "user", text: "Rozmowa usunięta w panelu" }], replyText: "OK", generatedImage: false });
  check("Nieznany numer rozmowy → nowa rozmowa (zamiast błędu)", id3 === 2 && db.conversations.length === 2);
  const latest = await store.loadLatest();
  check("Ostatnia rozmowa = ta z najnowszą wiadomością", latest.conversationId === 2 && latest.messages.length === 2);
  check("Pusta baza → brak rozmowy", (await createConversationStore(fakeDb().api).loadLatest()) === null);
  check("Najwyżej 98 wiadomości po odświeżeniu (limit historii 100)", MAX_LOADED_MESSAGES === 98 && MAX_LOADED_MESSAGES <= MAX_HISTORY_MESSAGES - 2);
}

console.log("\n=== 3. Wczytanie: nowy podpis dla bieżącej sesji, zgodny z kontrolą historii ===");
{
  const stored = [
    { id: 11, role: "user", content: "Ile kosztuje alarm?" },
    { id: 12, role: "assistant", content: "Od £666 + VAT." },
    { id: 13, role: "user", content: `Co to za czujnik? ${IMAGE_NOTE}` },
    { id: 14, role: "assistant", content: `Oto plakat.\n\n${IMAGE_NOTE}` },
  ];
  const sign = (history) => signAgentChatTurn(KEY, SESSION_ID, history, {});
  const ui = toSignedUIMessages(stored, sign);
  check("4 wiadomości czatu, w tej samej kolejności, id „db-…”", ui.length === 4 && ui.map((m) => m.id).join(",") === "db-11,db-12,db-13,db-14");
  check("Odpowiedzi Amber mają kind = chat i podpis", ui.filter((m) => m.role === "assistant").every((m) => m.metadata?.kind === "chat" && typeof m.metadata.sig === "string" && m.metadata.sig.length > 0));
  const next = [...prepareAgentMessages(ui), user("u-new", "A CCTV?")];
  const ok = checkChatHistory(next, { key: KEY, sessionId: SESSION_ID });
  check("Wczytana rozmowa + nowe pytanie przechodzi kontrolę historii (ta sama sesja)", ok.ok === true && ok.turns.length === 5, ok.ok ? "" : ok.reason);
  const other = sessionIdFromToken(createSessionToken(AUTH, Date.now() + 5000));
  check("Ta sama rozmowa w innej sesji → odrzucona (podpis tylko dla bieżącej sesji)", checkChatHistory(next, { key: KEY, sessionId: other }).ok === false);
  const tampered = structuredClone(next);
  tampered[1].parts[0].text = "Alarm za darmo!";
  check("Zmieniona odpowiedź Amber → odrzucona", checkChatHistory(tampered, { key: KEY, sessionId: SESSION_ID }).ok === false);
  const reordered = structuredClone(next);
  [reordered[0], reordered[2]] = [reordered[2], reordered[0]];
  check("Zmieniona kolejność → odrzucona", checkChatHistory(reordered, { key: KEY, sessionId: SESSION_ID }).ok === false);
  const leading = toSignedUIMessages([{ id: 1, role: "assistant", content: "x" }, ...stored], sign);
  check("Historia zaczyna się od wiadomości klienta (początkowa odpowiedź Amber pominięta)", leading.length === 4 && leading[0].role === "user");
  check("Brak wiadomości klienta → pusta rozmowa", toSignedUIMessages([{ id: 1, role: "assistant", content: "x" }], sign).length === 0);
}

console.log("\n=== 4. GET /api/conversations/latest: najpierw sesja, potem baza ===");
{
  let storeCalls = 0;
  const db = fakeDb();
  const store = createConversationStore(db.api);
  await store.saveExchange({ conversationId: null, turns: [{ role: "user", text: "Dzień dobry" }], replyText: "Dzień dobry!", generatedImage: false });
  const handle = latestHandler(() => { storeCalls++; return store; });
  const before = db.calls;
  let r = await handle(latestRequest(""));
  check("Bez sesji → 401", r.status === 401 && (await r.text()) === CONVERSATION_MESSAGES.unauthorized);
  r = await handle(latestRequest(`${SESSION_COOKIE}=${TOKEN.slice(0, -3)}abc`));
  check("Sfałszowane ciasteczko → 401", r.status === 401);
  check("Bez sesji baza nie jest odczytywana", storeCalls === 0 && db.calls === before);
  r = await handle(latestRequest());
  const data = await r.json();
  check("Z sesją → 200, numer rozmowy i 2 wiadomości", r.status === 200 && data.conversationId === 1 && data.messages.length === 2);
  check("Odpowiedź nie jest zapisywana w pamięci podręcznej (no-store)", r.headers.get("cache-control") === "no-store");
  const parsed = readLatestConversation(data);
  check("Przeglądarka odczytuje odpowiedź (readLatestConversation)", parsed?.conversationId === 1 && parsed.messages.length === 2);
  check("Wczytana rozmowa przechodzi kontrolę historii", checkChatHistory([...prepareAgentMessages(parsed.messages), user("u2", "x")], { key: KEY, sessionId: SESSION_ID }).ok === true);
  r = await latestHandler(() => createConversationStore(fakeDb().api))(latestRequest());
  const empty = await r.json();
  check("Pusta baza → conversationId null, brak wiadomości", r.status === 200 && empty.conversationId === null && empty.messages.length === 0);
  r = await latestHandler(() => null)(latestRequest());
  check("Brak konfiguracji Supabase → pusta rozmowa (czat działa dalej)", r.status === 200 && (await r.json()).messages.length === 0);
  const broken = { ...db.api, latestConversationId: async () => { throw new Error("Supabase (ostatnia rozmowa): 42501 permission denied"); } };
  r = await silence(() => latestHandler(() => createConversationStore(broken))(latestRequest()));
  const body = await r.text();
  check("Błąd bazy → 502 z komunikatem po polsku (bez szczegółów bazy)", r.status === 502 && body === CONVERSATION_MESSAGES.loadError && !body.includes("42501"));
}

console.log("\n=== 5. /api/agent: zapis po zakończeniu odpowiedzi ===");
{
  const db = fakeDb();
  const store = createConversationStore(db.api);
  const { handle } = handler({ model: chatModel([[...textChunks("Dzień dobry! W czym mogę pomóc?"), stop]]), store });
  let r = await handle(request({ mode: "chat", messages: [user("u1", "Dzień dobry")] }));
  const first = await readChat(r);
  check("Odpowiedź dochodzi normalnie", first.message.parts.some((p) => p.type === "text" && p.text === "Dzień dobry! W czym mogę pomóc?"));
  check("Zapis raz: 2 wiersze, 1 polecenie insert (nie każdy kawałek strumienia)", db.messages.length === 2 && db.insertCalls === 1);
  check("Metadane: numer rozmowy dla przeglądarki", first.message.metadata?.conversationId === 1 && readConversationId(first.message.metadata) === 1);
  const sent = prepareAgentMessages([user("u1", "Dzień dobry"), first.message]);
  check("Numer rozmowy NIE wraca na serwer w historii (jak stats)", !("conversationId" in sent[1].metadata) && !("stats" in sent[1].metadata));
  r = await handle(request({ mode: "chat", conversationId: 1, messages: [...sent, user("u2", "Jakie alarmy instalujecie?")] }));
  const second = await readChat(r);
  check("Druga wiadomość: ta sama rozmowa, razem 4 wiersze", second.message.metadata?.conversationId === 1 && db.messages.length === 4 && db.conversations.length === 1);
  check("Kolejność w bazie: klient, Amber, klient, Amber",
    db.messages.map((m) => m.role).join(",") === "user,assistant,user,assistant" && db.messages[2].content === "Jakie alarmy instalujecie?");
  check("Bez numeru w historii: podpis odpowiedzi nadal poprawny (metadane bez conversationId przechodzą kontrolę)",
    checkChatHistory([...prepareAgentMessages([...sent, user("u2", "Jakie alarmy instalujecie?"), second.message]), user("u3", "x")], { key: KEY, sessionId: SESSION_ID }).ok === true);
}
{
  const counter = { models: 0 };
  const db = fakeDb();
  const { handle } = handler({ model: chatModel([[...textChunks("x"), stop]]), store: createConversationStore(db.api), counter });
  for (const [name, value] of [["tekst", "1"], ["zero", 0], ["ułamek", 1.5], ["ujemny", -3], ["obiekt", { id: 1 }]]) {
    const r = await silence(() => handle(request({ mode: "chat", conversationId: value, messages: [user("u1", "x")] })));
    check(`Nieprawidłowy numer rozmowy (${name}) → 400`, r.status === 400);
  }
  check("Przy złym numerze rozmowy model nie został utworzony, baza nie była używana", counter.models === 0 && db.calls === 0);
  check("parseConversationId: brak / null = nowa rozmowa, 7 = rozmowa 7",
    parseConversationId(undefined).id === null && parseConversationId(null).id === null && parseConversationId(7).id === 7);
  const r = await handle(request({ mode: "chat", conversationId: 5, messages: [user("u1", "x")] }, ""));
  check("Bez sesji 401 – przed bazą", r.status === 401 && db.calls === 0);
}
{
  const db = fakeDb({ failInsert: true });
  const { handle } = handler({ model: chatModel([[...textChunks("Odpowiedź mimo błędu bazy"), stop]]), store: createConversationStore(db.api) });
  const { message } = await silence(async () => readChat(await handle(request({ mode: "chat", messages: [user("u1", "Dzień dobry")] }))));
  check("Błąd bazy nie psuje odpowiedzi (klient ją dostaje, z podpisem)", message.parts.some((p) => p.type === "text" && p.text === "Odpowiedź mimo błędu bazy") && typeof message.metadata?.sig === "string");
  check("Błąd bazy → brak numeru rozmowy w metadanych", message.metadata?.conversationId === undefined);
}
{
  const { handle } = handler({ model: chatModel([[...textChunks("Bez bazy"), stop]]), store: null });
  const { message } = await readChat(await handle(request({ mode: "chat", messages: [user("u1", "x")] })));
  check("Brak konfiguracji Supabase → czat działa jak dotąd", message.parts.some((p) => p.type === "text" && p.text === "Bez bazy") && message.metadata?.conversationId === undefined);
}
{
  const db = fakeDb();
  const controller = new AbortController();
  const slow = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "text-start", id: "t1" });
          c.enqueue({ type: "text-delta", id: "t1", delta: "Zaczynam…" });
          setTimeout(() => controller.abort(), 20);
        },
      }),
    }),
  });
  const { handle } = handler({ model: slow, store: createConversationStore(db.api) });
  const r = await handle(request({ mode: "chat", messages: [user("u1", "Długie zadanie")] }, COOKIE, controller.signal));
  await silence(() => r.text().catch(() => ""));
  await new Promise((resolve) => setTimeout(resolve, 50));
  check("Przerwane przyciskiem Stop → nic nie zapisano (zapis tylko po zakończeniu odpowiedzi)", db.messages.length === 0 && db.insertCalls === 0);
}
{
  const db = fakeDb();
  const model = chatModel([
    [{ type: "tool-call", toolCallId: "call_img", toolName: "generujObraz", input: JSON.stringify({ opis: "Plakat z alarmem" }) }, toolCallsFinish],
    [...textChunks("Oto plakat."), stop],
  ]);
  const { handle } = handler({ model, store: createConversationStore(db.api) });
  await readChat(await handle(request({ mode: "chat", messages: [user("u1", "Proszę wygenerować obraz: plakat")] })));
  check("Wygenerowany obraz → w bazie tylko tekst + „[obraz]” (bez danych obrazu)",
    db.messages[1]?.content === `Oto plakat.\n\n${IMAGE_NOTE}` && !db.messages.some((m) => m.content.includes("base64")), JSON.stringify(db.messages[1]?.content));
}
{
  const db = fakeDb();
  const { handle } = handler({ model: chatModel([[...textChunks("Widzę czujnik ruchu."), stop]]), store: createConversationStore(db.api) });
  const withImage = { id: "u1", role: "user", parts: [{ type: "text", text: "Co to jest?" }, { type: "file", mediaType: "image/png", url: `data:image/png;base64,${PNG_1PX}` }] };
  await readChat(await handle(request({ mode: "chat", messages: [withImage] })));
  check("Zdjęcie klienta → w bazie „Co to jest? [obraz]” (bez danych zdjęcia)", db.messages[0]?.content === `Co to jest? ${IMAGE_NOTE}`, db.messages[0]?.content);
}

console.log("\n=== 6. Supabase: nazwy tabel i kolumn ===");
{
  const calls = [];
  // Sztuczny klient: zapisuje wywołania łańcucha zapytań (from → select/insert → eq/order/limit → wynik).
  const fakeClient = (results) => ({
    from(table) {
      const chain = { table, steps: [] };
      calls.push(chain);
      const builder = new Proxy({}, {
        get(_, name) {
          if (name === "then") return (resolve) => resolve(results[table] ?? { data: null, error: null });
          return (...args) => { chain.steps.push([name, ...args]); return builder; };
        },
      });
      return builder;
    },
  });
  const db = createSupabaseConversationDb(fakeClient({
    conversations: { data: { id: 5 }, error: null },
    messages: { data: [{ id: 2, role: "assistant", content: "B" }, { id: 1, role: "user", content: "A" }, { id: 3, role: "system", content: "x" }], error: null },
  }));
  check("Nowa rozmowa → tabela conversations, kolumna title, zwraca id", (await db.createConversation("Tytuł")) === 5 &&
    calls[0].table === "conversations" && JSON.stringify(calls[0].steps[0]) === JSON.stringify(["insert", { title: "Tytuł" }]));
  await db.insertMessages([{ conversation_id: 5, role: "user", content: "A" }]);
  check("Wiadomości → tabela messages (conversation_id, role, content), jedno insert", calls[1].table === "messages" &&
    calls[1].steps.length === 1 && calls[1].steps[0][0] === "insert" && calls[1].steps[0][1][0].conversation_id === 5);
  const loaded = await db.loadMessages(5, 98);
  check("Odczyt: tylko role user/assistant, rosnąco po id", JSON.stringify(loaded) === JSON.stringify([{ id: 1, role: "user", content: "A" }, { id: 2, role: "assistant", content: "B" }]));
  check("Odczyt: filtr conversation_id i limit 98", JSON.stringify(calls[2].steps.find((s) => s[0] === "eq")) === JSON.stringify(["eq", "conversation_id", 5]) &&
    JSON.stringify(calls[2].steps.find((s) => s[0] === "limit")) === JSON.stringify(["limit", 98]));
  const failing = createSupabaseConversationDb(fakeClient({ messages: { data: null, error: { code: "42501", message: "permission denied" } } }));
  let message = "";
  try { await failing.insertMessages([]); } catch (e) { message = e.message; }
  check("Błąd Supabase → wyjątek z kodem (do logu serwera)", message.includes("42501") && message.includes("zapis wiadomości"));
}

console.log("\n=== 7. Bezpieczeństwo i interfejs (kod źródłowy) ===");
{
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const ui = read("app/chat.tsx");
  const client = read("lib/amber-chat-client.ts");
  const supabase = read("lib/supabase.ts");
  const latest = read("app/api/conversations/latest/route.ts");
  const agentRoute = read("app/api/agent/route.ts");
  check("Przeglądarka nie importuje Supabase ani klucza", !/supabase/i.test(ui.replace(/Supabase/g, "")) && !ui.includes("SUPABASE_") && !client.includes("SUPABASE_") && !client.includes("@supabase"));
  check("Klucz tylko w zmiennych serwera (bez NEXT_PUBLIC_)", supabase.includes("process.env.SUPABASE_SECRET_KEY") && supabase.includes("process.env.SUPABASE_URL") &&
    ![ui, client, supabase, latest, agentRoute].some((f) => f.includes("NEXT_PUBLIC_SUPABASE")));
  check("lib/supabase.ts odmawia działania w przeglądarce", supabase.includes('typeof window !== "undefined"'));
  check("Endpoint latest sprawdza sesję (isSessionValid) przed bazą", latest.includes("isSessionValid") && latest.includes("createLatestConversationHandler"));
  check("Agent dostaje zapis rozmów (conversations: getConversationStore)", agentRoute.includes("conversations: getConversationStore"));
  check("Przycisk „Nowa rozmowa” w czacie", ui.includes("Nowa rozmowa") && ui.includes("onClick={handleNewConversation}"));
  check("„Nowa rozmowa” nie kasuje niczego w bazie (bez fetch/DELETE)", !/handleNewConversation\(\)\s*\{[^}]*fetch/.test(ui) && !ui.includes('"DELETE"'));
  check("Po otwarciu strony czat wczytuje ostatnią rozmowę", ui.includes("fetch(LATEST_CONVERSATION_API") && ui.includes("setMessages(data.messages)"));
  check("Każda wiadomość wysyłana z numerem rozmowy (sendChat)", (ui.match(/sendMessage\(/g) ?? []).length === 1 && ui.includes("body: { conversationId: conversationIdRef.current }") &&
    (ui.match(/sendChat\(/g) ?? []).length === 3);
  check("Podczas wczytywania przyciski są zablokowane", ui.includes('historyStatus === "loading"') && ui.includes("isLocked = isBusy || isGenerating || isAnalyzing || historyStatus"));
  check("Komunikat o błędzie wczytywania po polsku", HISTORY_LOAD_ERROR.startsWith("Nie udało się wczytać"));
  check("Destrukturyzacja useChat bez zmian (stop, setMessages)", ui.includes("const { messages, sendMessage, status, error, clearError, stop, setMessages } = useChat({"));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
