// Testy W2: walidator wyniku Amber oraz obsługa błędów – BEZ wywoływania prawdziwego modelu.
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-output.mjs
// Sztuczny model (MockLanguageModelV4) pochodzi z biblioteki "ai" – nic nie trafia do OpenRouter.

import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { cleanSources, generateAmberOutput, validateAmberOutput } from "../lib/amber-output.ts";
import { aktualnyCzas, checkArea, currentTimeInfo, deviceInfo, informacjeOUrzadzeniu, sprawdzObszar } from "../lib/amber-tools.ts";

let passed = 0;
let failed = 0;

function check(name, condition, info = "") {
  if (condition) {
    passed++;
    console.log(`✅ ${name}${info ? `  → ${info}` : ""}`);
  } else {
    failed++;
    console.log(`❌ ${name}${info ? `  → ${info}` : ""}`);
  }
}

const VALID = {
  category: "sales",
  priority: "normal",
  draft: "Instalacja alarmu bezprzewodowego kosztuje od £666 + VAT.",
  needs_review: false,
};

// ---------------------------------------------------------------------------
console.log("\n=== CZĘŚĆ 1: walidator (bez modelu) ===");
// ---------------------------------------------------------------------------

{
  const r = validateAmberOutput(VALID);
  check("Poprawny wynik zostaje przyjęty", r.success === true);
}

const invalidCases = [
  ["1. Brak pola draft", (() => { const { draft, ...rest } = VALID; return rest; })()],
  ['2. needs_review jako tekst "false"', { ...VALID, needs_review: "false" }],
  ["3. category = marketing", { ...VALID, category: "marketing" }],
  ["4. Dodatkowe pole send_now", { ...VALID, send_now: true }],
  ["Dodatkowo: priority = urgent", { ...VALID, priority: "urgent" }],
  ["Dodatkowo: pusty draft", { ...VALID, draft: "   " }],
  ["Dodatkowo: null zamiast obiektu", null],
  ["Dodatkowo: tablica zamiast obiektu", [VALID]],
];

for (const [name, value] of invalidCases) {
  const r = validateAmberOutput(value);
  check(`${name} → odrzucone`, r.success === false, r.success ? "PRZYJĘTE (błąd!)" : r.errors.join(" "));
}

// ---------------------------------------------------------------------------
console.log("\n=== CZĘŚĆ 2: obsługa odpowiedzi modelu (sztuczny model) ===");
// ---------------------------------------------------------------------------

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function mockModel(text, finish = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: text ? [{ type: "text", text }] : [],
      finishReason: { unified: finish, raw: finish },
      usage,
      warnings: [],
    }),
  });
}

async function run(model, extra = {}) {
  return generateAmberOutput({
    model,
    instructions: "test",
    messages: [{ role: "user", content: "Ile kosztuje instalacja systemu alarmowego?" }],
    maxRetries: 0,
    ...extra,
  });
}

function expectFailure(name, r, kind) {
  const ok = r.ok === false && r.kind === kind && !("output" in r);
  check(name, ok, r.ok ? `PRZYJĘTE: ${JSON.stringify(r.output)}` : `${r.kind} | ${r.details}`);
}

{
  const r = await run(mockModel(JSON.stringify(VALID)));
  check("Poprawny JSON od modelu → przyjęty", r.ok === true && r.output.draft === VALID.draft,
    r.ok ? `draft: "${r.output.draft}"` : `${r.kind} | ${r.details}`);
}

expectFailure("Model zwraca category=marketing → odrzucone (invalid_output)",
  await run(mockModel(JSON.stringify({ ...VALID, category: "marketing" }))), "invalid_output");

expectFailure("Model zwraca dodatkowe pole send_now → odrzucone (invalid_output)",
  await run(mockModel(JSON.stringify({ ...VALID, send_now: true }))), "invalid_output");

expectFailure("Model zwraca zwykły tekst zamiast JSON → odrzucone (invalid_output)",
  await run(mockModel("Dzień dobry, instalacja kosztuje od £666.")), "invalid_output");

expectFailure("Kontrolowana odmowa (content-filter, brak treści) → refusal",
  await run(mockModel("", "content-filter")), "refusal");

expectFailure("Kontrolowana odmowa (content-filter, z treścią) → refusal",
  await run(mockModel(JSON.stringify(VALID), "content-filter")), "refusal");

expectFailure("Przerwanie: limit długości, ucięty JSON → interrupted",
  await run(mockModel('{"category":"sales","priority":"normal","dra', "length")), "interrupted");

expectFailure("Przerwanie: limit długości, ale JSON kompletny → interrupted (nie przepuszczamy)",
  await run(mockModel(JSON.stringify(VALID), "length")), "interrupted");

{
  const controller = new AbortController();
  const slowModel = new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")));
      }),
  });
  setTimeout(() => controller.abort(), 50);
  expectFailure("Przerwanie połączenia (abort) w trakcie odpowiedzi → interrupted",
    await run(slowModel, { abortSignal: controller.signal }), "interrupted");
}

{
  const brokenProvider = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: "Service Unavailable",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: false,
      });
    },
  });
  expectFailure("Błąd dostawcy (HTTP 503) → provider_error", await run(brokenProvider), "provider_error");
}

{
  const crashing = new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("Nieoczekiwany błąd"); },
  });
  expectFailure("Nieoczekiwany błąd → provider_error", await run(crashing), "provider_error");
}

// ---------------------------------------------------------------------------
console.log("\n=== CZĘŚĆ 3 (lekcja 3): źródła z wyszukiwania ===");
// ---------------------------------------------------------------------------

{
  const withSources = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: "source", sourceType: "url", id: "1", url: "https://www.example.org/norma", title: "Norma BS EN 50131" },
        { type: "source", sourceType: "url", id: "2", url: "https://www.example.org/norma", title: "Duplikat" },
        { type: "source", sourceType: "url", id: "3", url: "javascript:alert(1)", title: "Złośliwy link" },
        { type: "source", sourceType: "url", id: "4", url: "https://producent.example.com/panel", title: "" },
        { type: "text", text: JSON.stringify(VALID) },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });
  const r = await run(withSources);
  check("Odpowiedź ze źródłami → przyjęta, źródła zwrócone", r.ok === true && Array.isArray(r.sources),
    r.ok ? `${r.sources.length} źródła` : `${r.kind} | ${r.details}`);
  check("Źródła: duplikat usunięty, link javascript: odrzucony", r.ok && r.sources.length === 2,
    r.ok ? r.sources.map((x) => x.url).join(" , ") : "");
  check("Źródło bez tytułu → tytuł = nazwa strony", r.ok && r.sources[1]?.title === "producent.example.com",
    r.ok ? `"${r.sources[1]?.title}"` : "");
}
{
  const r = await run(mockModel(JSON.stringify(VALID)));
  check("Odpowiedź bez wyszukiwania → pusta lista źródeł", r.ok === true && r.sources.length === 0);
}
check("cleanSources odrzuca data:, ftp: i błędne adresy",
  cleanSources([{ url: "data:text/html,x" }, { url: "ftp://x.org" }, { url: "nie-adres" }, { url: 42 }]).length === 0);
check("cleanSources ogranicza liczbę źródeł do 6",
  cleanSources(Array.from({ length: 10 }, (_, i) => ({ url: `https://s${i}.example.com` }))).length === 6);

// ---------------------------------------------------------------------------
console.log("\n=== CZĘŚĆ 4 (lekcja 3): narzędzie aktualnyCzas i lista narzędzi ===");
// ---------------------------------------------------------------------------
{
  const winter = currentTimeInfo(new Date("2026-11-10T18:50:00Z"));
  check("aktualnyCzas (zima): 10.11.2026, wtorek, 18:50 czasu Londynu",
    winter.data === "10.11.2026" && winter.dzienTygodnia === "wtorek" && winter.godzina === "18:50" && winter.strefa === "Europe/London",
    JSON.stringify(winter));
  const summer = currentTimeInfo(new Date("2026-07-01T12:00:00Z"));
  check("aktualnyCzas (lato): czas letni w Londynie = 13:00", summer.godzina === "13:00" && summer.dzienTygodnia === "środa",
    JSON.stringify(summer));
}
{
  let executed = false;
  const tool = { ...aktualnyCzas, execute: async (...a) => { executed = true; return aktualnyCzas.execute(...a); } };
  const twoSteps = new MockLanguageModelV4({
    doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "t1", toolName: "aktualnyCzas", input: "{}" }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] },
      { content: [{ type: "text", text: JSON.stringify({ ...VALID, draft: "Dziś jest wtorek, 10.11.2026." }) }],
        finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
    ],
  });
  const r = await run(twoSteps, { tools: { aktualnyCzas: tool } });
  check("Model wywołuje aktualnyCzas, potem zwraca JSON → przyjęte", r.ok === true && executed,
    r.ok ? `draft: "${r.output.draft}"` : `${r.kind} | ${r.details}`);
  check("Lista narzędzi = [aktualnyCzas]", r.ok && JSON.stringify(r.tools) === JSON.stringify(["aktualnyCzas"]),
    r.ok ? JSON.stringify(r.tools) : "");
  const sent = twoSteps.doGenerateCalls[0]?.tools?.map((t) => t.name) ?? [];
  check("Narzędzie przekazane do modelu z opisem", sent.includes("aktualnyCzas") &&
    /dziś|jutr|dni/i.test(twoSteps.doGenerateCalls[0].tools.find((t) => t.name === "aktualnyCzas").description));
}
{
  const both = new MockLanguageModelV4({
    doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "t1", toolName: "aktualnyCzas", input: "{}" }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] },
      { content: [{ type: "source", sourceType: "url", id: "1", url: "https://www.example.org/x", title: "X" },
                  { type: "text", text: JSON.stringify(VALID) }],
        finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
    ],
  });
  const r = await run(both, { tools: { aktualnyCzas } });
  check("Wyszukiwanie + aktualnyCzas → [wyszukiwanie, aktualnyCzas]",
    r.ok && JSON.stringify(r.tools) === JSON.stringify(["wyszukiwanie", "aktualnyCzas"]), r.ok ? JSON.stringify(r.tools) : "");
}
{
  const r = await run(mockModel(JSON.stringify(VALID)), { tools: { aktualnyCzas } });
  check("Bez użycia narzędzi → pusta lista (brak etykiet)", r.ok && r.tools.length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== CZĘŚĆ 5 (lekcja 3): sprawdzObszar i informacjeOUrzadzeniu ===");
// ---------------------------------------------------------------------------
const areaCases = [
  ["SW19 1AA", "w_obszarze", "SW"], ["sw191aa", "w_obszarze", "SW"], ["EC1A 1BB", "w_obszarze", "EC"],
  ["E1 6AN", "w_obszarze", "E"], ["WD3 1AA", "w_obszarze", "WD"], ["W1A 1AA", "w_obszarze", "W"],
  ["KT1", "w_obszarze", "KT"], ["RH1 1AA", "do_potwierdzenia", "RH"], ["GU1 1AA", "do_potwierdzenia", "GU"],
  ["M1 1AE", "poza_obszarem", "M"], ["S1 2AA", "poza_obszarem", "S"], ["B33 8TH", "poza_obszarem", "B"],
  ["abc", "nieprawidlowy_kod", null], ["", "nieprawidlowy_kod", null], ["12345", "nieprawidlowy_kod", null],
];
for (const [code, expected, area] of areaCases) {
  const r = checkArea(code);
  check(`sprawdzObszar("${code}") → ${expected}`, r.wynik === expected && r.obszarKodu === area, `${r.wynik}, obszar ${r.obszarKodu}`);
}
check("sprawdzObszar: komunikat zawsze wspomina zespół (poza błędnym kodem)",
  ["SW19 1AA", "RH1 1AA", "M1 1AE"].every((c) => /zespół/.test(checkArea(c).komunikat)));

const brandCases = [
  ["Texecom", "Texecom"], ["texecom premier elite", "Texecom"], ["AJAX Hub 2", "Ajax"], ["Pyronix Enforcer", "Pyronix"],
  ["Honeywell Galaxy", null], ["", null],
];
for (const [name, expected] of brandCases) {
  const r = deviceInfo(name);
  check(`informacjeOUrzadzeniu("${name}") → ${expected ?? "inna marka"}`, r.obslugiwanaMarka === expected, r.komunikat.slice(0, 60) + "…");
}
check("informacjeOUrzadzeniu: brak cen w komunikatach",
  [deviceInfo("Texecom"), deviceInfo("Honeywell")].every((r) => !/£|\bcen/i.test(r.komunikat)));

{
  const flow = new MockLanguageModelV4({
    doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "t1", toolName: "sprawdzObszar", input: JSON.stringify({ kodPocztowy: "SW19 1AA" }) },
                  { type: "tool-call", toolCallId: "t2", toolName: "informacjeOUrzadzeniu", input: JSON.stringify({ producent: "Texecom" }) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] },
      { content: [{ type: "text", text: JSON.stringify(VALID) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
    ],
  });
  const r = await run(flow, { tools: { aktualnyCzas, sprawdzObszar, informacjeOUrzadzeniu } });
  check("Model wywołuje sprawdzObszar + informacjeOUrzadzeniu → etykiety obu", r.ok &&
    JSON.stringify(r.tools) === JSON.stringify(["sprawdzObszar", "informacjeOUrzadzeniu"]), r.ok ? JSON.stringify(r.tools) : `${r.kind} | ${r.details}`);
  const second = flow.doGenerateCalls[1]?.prompt ?? [];
  const toolMsg = JSON.stringify(second.filter((m) => m.role === "tool"));
  check("Wyniki narzędzi trafiają do modelu (w_obszarze, Texecom)", toolMsg.includes("w_obszarze") && toolMsg.includes("Texecom"));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log("\n=== Lekcja 3 (Vision): zdjęcie i faktycznie użyty model ===");
// ---------------------------------------------------------------------------
{
  const visionModel = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(VALID) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
      response: { id: "r1", modelId: "google/gemini-3.8-flash-20261001", timestamp: new Date(0) },
    }),
  });
  const B64 = Buffer.from("fikcyjne-zdjecie").toString("base64");
  const r = await run(visionModel, {
    messages: [{ role: "user", content: [
      { type: "text", text: "Co oznacza ten komunikat?" },
      { type: "image", image: B64, mediaType: "image/jpeg" },
    ] }],
  });
  check("Wynik zawiera model zwrócony przez API (nie wpisany na sztywno)", r.ok && r.modelId === "google/gemini-3.8-flash-20261001", r.ok ? r.modelId : r.details);
  const sentPrompt = JSON.stringify(visionModel.doGenerateCalls[0]?.prompt ?? []);
  check("Zdjęcie zostało przekazane do modelu jako część typu file", sentPrompt.includes('"type":"file"') && sentPrompt.includes("image/jpeg"));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
