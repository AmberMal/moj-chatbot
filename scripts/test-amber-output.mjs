// Testy W2: walidator wyniku Amber oraz obsługa błędów – BEZ wywoływania prawdziwego modelu.
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-output.mjs
// Sztuczny model (MockLanguageModelV4) pochodzi z biblioteki "ai" – nic nie trafia do OpenRouter.

import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { generateAmberOutput, validateAmberOutput } from "../lib/amber-output.ts";

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
console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
