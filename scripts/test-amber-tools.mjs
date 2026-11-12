// Testy lekcji 4: osiem narzędzi pomocniczych – BEZ internetu (sztuczny fetch) i BEZ OpenRouter (sztuczny model).
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-tools.mjs

import { readUIMessageStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { readFileSync } from "node:fs";
import {
  AGENT_STEP_LIMIT,
  AGENT_TOOL_CALL_LIMIT,
  AGENT_TOOL_SOFT_LIMIT,
  TOOL_SKIPPED_MESSAGE,
  createAgentHandler,
  createToolBudget,
} from "../lib/amber-agent.ts";
import { MockImageModelV4 } from "ai/test";
import { IMAGE_MODEL_ID, createImageTool } from "../lib/amber-image.ts";
import { prepareAgentMessages } from "../lib/amber-chat-client.ts";
import { SESSION_COOKIE, createSessionToken, isSessionValid, readCookie } from "../lib/auth.ts";
import { AMBER_ANALYZE_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS_DEV } from "../lib/amber-instructions.ts";
import { generateAmberOutput } from "../lib/amber-output.ts";
import { informacjeOUrzadzeniu, sprawdzObszar } from "../lib/amber-tools.ts";
import {
  FORECAST_DAYS,
  createCurrencyTool,
  createHolidaysTool,
  createWeatherTool,
  createWikipediaTool,
  getCurrency,
  getHolidays,
  getWeather,
  getWikipedia,
} from "../lib/amber-tools-api.ts";
import {
  MAX_NOTES,
  MAX_NOTE_CHARS,
  calculate,
  createDiagnosticsTool,
  createNotesTool,
  czas,
  diagnostics,
  kalkulator,
  runNotes,
  timeIn,
} from "../lib/amber-tools-local.ts";
import {
  HISTORY_TOOL_NAMES,
  MAX_AGENT_TOOL_PARTS,
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
const NOW = new Date("2026-11-12T18:30:05Z");
const now = () => NOW;

// Sztuczny fetch: routes = [[fragment adresu, odpowiedź | funkcja]]. Zapisuje wywołane adresy.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    for (const [part, reply] of routes) {
      if (url.includes(part)) {
        const r = typeof reply === "function" ? await reply(url, init) : reply;
        if (r instanceof Response) return r;
        return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("Not Found", { status: 404 });
  };
  f.calls = calls;
  return f;
}
const status = (code) => new Response("x", { status: code });
const neverAnswers = (_url, init) =>
  new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
const networkDown = () => Promise.reject(new TypeError("fetch failed"));

// ---------------------------------------------------------------------------
console.log("\n=== 1. pogoda (Open-Meteo) ===");
const GEO = { results: [{ name: "Londyn", latitude: 51.5, longitude: -0.12, country: "Wielka Brytania", timezone: "Europe/London" }] };
const FORECAST = {
  daily: {
    time: ["2026-11-12", "2026-11-13", "2026-11-27"],
    temperature_2m_max: [11.2, 9.8, 7],
    temperature_2m_min: [5.1, 3.4, 1],
    precipitation_sum: [0.4, 6.2, 0],
    weather_code: [3, 63, 0],
    extra_field_not_needed: [1, 2, 3],
  },
};
{
  const f = fakeFetch([["geocoding-api", GEO], ["api.open-meteo.com/v1/forecast", FORECAST]]);
  const r = await getWeather({ miasto: "Londyn", data: "2026-11-13" }, { fetch: f, now });
  check("Prognoza na podany dzień", r.ok && r.data === "2026-11-13" && r.temperaturaMaxC === 9.8 && r.opadyMm === 6.2 && r.opis === "deszcz", JSON.stringify(r));
  check("Zwraca tylko potrzebne pola + godzinę pobrania", r.ok && Object.keys(r).sort().join() === "data,kraj,miasto,ok,opadyMm,opis,pobrano,temperaturaMaxC,temperaturaMinC,zrodlo" && r.pobrano === "12.11.2026, 18:30:05");
  const geoUrl = new URL(f.calls[0].url);
  check("Geokodowanie: name, count=1, language=pl", geoUrl.searchParams.get("name") === "Londyn" && geoUrl.searchParams.get("count") === "1" && geoUrl.searchParams.get("language") === "pl");
  const fUrl = new URL(f.calls[1].url);
  check(`Prognoza: forecast_days=${FORECAST_DAYS} (16 dni)`, fUrl.searchParams.get("forecast_days") === "16" && FORECAST_DAYS === 16, f.calls[1].url);
  check("Prognoza: współrzędne z geokodowania i pola daily", fUrl.searchParams.get("latitude") === "51.5" && fUrl.searchParams.get("daily") === "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code" && fUrl.searchParams.get("timezone") === "auto");
  const today = await getWeather({ miasto: "Londyn" }, { fetch: f, now });
  check("Bez daty → dzisiaj (strefa miasta)", today.ok && today.data === "2026-11-12", today.data ?? today.komunikat);
  const far = await getWeather({ miasto: "Londyn", data: "2026-11-27" }, { fetch: f, now });
  check("Dalszy dzień z zakresu 16 dni → działa", far.ok && far.opis === "bezchmurnie");
  const out = await getWeather({ miasto: "Londyn", data: "2027-01-10" }, { fetch: f, now });
  check("Dzień poza zakresem → komunikat po polsku z zakresem", !out.ok && out.komunikat.includes("od 2026-11-12 do 2026-11-27"), out.komunikat);
}
{
  const r = await getWeather({ miasto: "Xyzabc" }, { fetch: fakeFetch([["geocoding-api", { generationtime_ms: 0.1 }]]), now });
  check("Brak miasta → „Nie znalazłam miasta…”", !r.ok && r.komunikat.startsWith("Nie znalazłam miasta „Xyzabc”"), r.komunikat);
  const r2 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", status(500)]]), now });
  check("Błąd 500 → „Serwis … nie odpowiada”", !r2.ok && r2.komunikat.includes("nie odpowiada") && r2.pobrano);
  const r3 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", neverAnswers]]), now, timeoutMs: 30 });
  check("Brak odpowiedzi (timeout) → komunikat zamiast błędu", !r3.ok && r3.komunikat.includes("nie odpowiada"));
  const r4 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", GEO], ["forecast", networkDown]]), now });
  check("Prognoza niedostępna (sieć) → komunikat", !r4.ok && r4.komunikat.includes("nie odpowiada"));
  const r5 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", new Response("<html>", { status: 200 })]]), now });
  check("Zły JSON → komunikat", !r5.ok && r5.komunikat.includes("nie odpowiada"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. waluty (NBP) ===");
const EUR = { table: "A", currency: "euro", code: "EUR", rates: [{ no: "220/A/NBP/2026", effectiveDate: "2026-11-12", mid: 4.2512 }] };
{
  const f = fakeFetch([["/rates/A/EUR/", EUR]]);
  const r = await getCurrency({ waluta: "EUR", kwota: 100 }, { fetch: f, now });
  check("Kurs EUR z tabeli A + przeliczenie 100 EUR", r.ok && r.kursPLN === 4.2512 && r.kwotaPLN === 425.12 && r.dataKursu === "2026-11-12" && r.tabela === "A", JSON.stringify(r));
  check("Adres: api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json", f.calls[0].url === "https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json");
  check("Bez pola 'no' (tylko potrzebne pola)", r.ok && !("no" in r) && r.pobrano === "12.11.2026, 18:30:05");
  const f2 = fakeFetch([["/rates/B/AFN/", { table: "B", currency: "afgani", code: "AFN", rates: [{ effectiveDate: "2026-11-12", mid: 0.0551 }] }]]);
  const b = await getCurrency({ waluta: "AFN" }, { fetch: f2, now });
  check("Brak w tabeli A (404) → tabela B", b.ok && b.tabela === "B" && f2.calls.length === 2 && !("kwotaPLN" in b));
  const none = await getCurrency({ waluta: "XYZ" }, { fetch: fakeFetch([]), now });
  check("Nieznana waluta (404 w A i B) → komunikat po polsku", !none.ok && none.komunikat.includes("NBP nie publikuje kursu waluty „XYZ”"), none.komunikat);
  const down = await getCurrency({ waluta: "EUR" }, { fetch: fakeFetch([["nbp", status(503)]]), now });
  check("NBP nie odpowiada → komunikat", !down.ok && down.komunikat === "Serwis NBP nie odpowiada. Spróbuj ponownie za chwilę.");
  const pln = await getCurrency({ waluta: "PLN" }, { fetch: fakeFetch([]), now });
  check("PLN → komunikat (waluta bazowa), bez zapytania", !pln.ok && pln.komunikat.includes("waluta bazowa"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. swieta (Nager.Date) ===");
{
  const data = [
    { date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day", countryCode: "GB", global: false, counties: ["GB-ENG"], types: ["Public"] },
    { date: "2026-12-28", localName: "Boxing Day", name: "St. Stephen's Day", countryCode: "GB" },
  ];
  const f = fakeFetch([["date.nager.at/api/v3/PublicHolidays/2026/GB", data]]);
  const r = await getHolidays({ kraj: "GB", rok: 2026 }, { fetch: f, now });
  check("Lista świąt GB 2026", r.ok && r.swieta.length === 2 && r.swieta[1].nazwaLokalna === "Boxing Day", JSON.stringify(r));
  check("Tylko potrzebne pola świąt (data, nazwaLokalna, nazwa, ogolnokrajowe, regiony)", r.ok && Object.keys(r.swieta[0]).join() === "data,nazwaLokalna,nazwa,ogolnokrajowe,regiony" && r.pobrano, Object.keys(r.swieta[0]).join());
  check("global: false → ogolnokrajowe: false", r.ok && r.swieta[0].ogolnokrajowe === false);
  check("Brak pola global w API → brak pola ogolnokrajowe (bez zgadywania)", r.ok && !("ogolnokrajowe" in r.swieta[1]));
  check("Regiony z API (GB-ENG → Anglia)", r.ok && JSON.stringify(r.swieta[0].regiony) === '["Anglia"]');
  check("Brak regionów w API → brak pola regiony (nic nie dopisujemy)", r.ok && !("regiony" in r.swieta[1]));
  const mixed = await getHolidays({ kraj: "GB", rok: 2026 }, { fetch: fakeFetch([["nager", [
    { date: "2026-01-02", localName: "2 January", name: "2 January", counties: ["GB-SCT"] },
    { date: "2026-03-17", localName: "Saint Patrick's Day", name: "Saint Patrick's Day", counties: ["GB-NIR"] },
    { date: "2026-04-06", localName: "Easter Monday", name: "Easter Monday", counties: ["GB-ENG", "GB-WLS", "GB-NIR"] },
    { date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day", counties: null, global: true },
    { date: "2026-12-26", localName: "Q", name: "Q", global: "tak" },
    { date: "2026-06-01", localName: "X", name: "X", counties: ["DE-BY"] },
    { date: "2026-06-02", localName: "Y", name: "Y", counties: [] },
    { date: "2026-06-03", localName: "Z", name: "Z", counties: ["<script>", 5] },
  ]]]), now });
  check("Szkocja / Irlandia Północna / kilka regionów", mixed.ok && mixed.swieta[0].regiony.join() === "Szkocja" && mixed.swieta[1].regiony.join() === "Irlandia Północna" && mixed.swieta[2].regiony.join() === "Anglia,Walia,Irlandia Północna");
  check("counties: null → bez regionów", mixed.ok && !("regiony" in mixed.swieta[3]));
  check("global: true → ogolnokrajowe: true", mixed.ok && mixed.swieta[3].ogolnokrajowe === true);
  check("global nie jest true/false → brak pola ogolnokrajowe", mixed.ok && mixed.swieta[4].nazwa === "Q" && !("ogolnokrajowe" in mixed.swieta[4]));
  check("Nieznany kod regionu pokazany bez zmian (DE-BY)", mixed.ok && mixed.swieta[5].regiony.join() === "DE-BY");
  check("Pusta lista albo złe wartości → bez regionów", mixed.ok && !("regiony" in mixed.swieta[6]) && !("regiony" in mixed.swieta[7]));
  const bad = await getHolidays({ kraj: "QQ", rok: 2026 }, { fetch: fakeFetch([]), now });
  check("Nieznany kraj (404) → komunikat", !bad.ok && bad.komunikat.includes("Nie mam listy świąt dla kraju „QQ”"));
  const empty = await getHolidays({ kraj: "QQ", rok: 2026 }, { fetch: fakeFetch([["nager", new Response("", { status: 200 })]]), now });
  check("Pusta odpowiedź → komunikat", !empty.ok && empty.komunikat.includes("Nie mam listy"));
  const down = await getHolidays({ kraj: "PL", rok: 2026 }, { fetch: fakeFetch([["nager", networkDown]]), now });
  check("Serwis nie odpowiada → komunikat", !down.ok && down.komunikat.includes("Nager.Date nie odpowiada"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. wikipedia (pl) ===");
{
  const page = {
    type: "standard", title: "Telewizja przemysłowa", extract: "Telewizja przemysłowa (CCTV) – system kamer…",
    content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Telewizja_przemys%C5%82owa" } }, thumbnail: { source: "x" },
  };
  const f = fakeFetch([["pl.wikipedia.org/api/rest_v1/page/summary/", page]]);
  const r = await getWikipedia({ haslo: "Telewizja przemysłowa" }, { fetch: f, now });
  check("Streszczenie + link", r.ok && r.tytul === "Telewizja przemysłowa" && r.link.startsWith("https://pl.wikipedia.org/wiki/") && !("thumbnail" in r), JSON.stringify(r));
  check("Adres: spacje → _, polskie znaki zakodowane", f.calls[0].url === "https://pl.wikipedia.org/api/rest_v1/page/summary/Telewizja_przemys%C5%82owa", f.calls[0].url);
  check("Wysyła nagłówek User-Agent (wymóg Wikipedii)", /AmberChatbot/.test(f.calls[0].init.headers["Api-User-Agent"]));
  const none = await getWikipedia({ haslo: "Qwertyzxc" }, { fetch: fakeFetch([]), now });
  check("Brak hasła (404) → komunikat", !none.ok && none.komunikat.includes("nie ma hasła „Qwertyzxc”"));
  const dis = await getWikipedia({ haslo: "Zamek" }, { fetch: fakeFetch([["summary", { type: "disambiguation", title: "Zamek", extract: "Zamek – …", content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Zamek" } } }]]), now });
  check("Strona ujednoznaczniająca → prośba o doprecyzowanie", !dis.ok && dis.komunikat.includes("kilka znaczeń"));
  const long = await getWikipedia({ haslo: "X" }, { fetch: fakeFetch([["summary", { type: "standard", title: "X", extract: "a".repeat(5000) }]]), now });
  check("Długie streszczenie skrócone (≤1201 znaków)", long.ok && long.streszczenie.length <= 1201);
  const down = await getWikipedia({ haslo: "X" }, { fetch: fakeFetch([["summary", status(502)]]), now });
  check("Wikipedia nie odpowiada → komunikat", !down.ok && down.komunikat.includes("Wikipedia nie odpowiada"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. kalkulator ===");
{
  check("dodaj 2+3+4 = 9", calculate({ dzialanie: "dodaj", liczby: [2, 3, 4] }, NOW).wynik === 9);
  check("odejmij 10-3-2 = 5", calculate({ dzialanie: "odejmij", liczby: [10, 3, 2] }, NOW).wynik === 5);
  check("pomnoz 0.1*3 = 0.3 (zaokrąglenie)", calculate({ dzialanie: "pomnoz", liczby: [0.1, 3] }, NOW).wynik === 0.3);
  check("podziel 666/4 = 166.5", calculate({ dzialanie: "podziel", liczby: [666, 4] }, NOW).wynik === 166.5);
  check("procent 20% z 666 = 133.2", calculate({ dzialanie: "procent", liczby: [20, 666] }, NOW).wynik === 133.2);
  check("potega 2^10 = 1024", calculate({ dzialanie: "potega", liczby: [2, 10] }, NOW).wynik === 1024);
  check("pierwiastek 81 = 9", calculate({ dzialanie: "pierwiastek", liczby: [81] }, NOW).wynik === 9);
  const z = calculate({ dzialanie: "podziel", liczby: [1, 0] }, NOW);
  check("Dzielenie przez zero → komunikat", !z.ok && z.komunikat === "Nie można dzielić przez zero.");
  check("Pierwiastek z liczby ujemnej → komunikat", !calculate({ dzialanie: "pierwiastek", liczby: [-4] }, NOW).ok);
  check("Za mało liczb → komunikat", !calculate({ dzialanie: "dodaj", liczby: [1] }, NOW).ok);
  check("Wynik zbyt duży → komunikat", !calculate({ dzialanie: "potega", liczby: [10, 400] }, NOW).ok);
  const v = kalkulator.inputSchema.validate;
  check("Schemat: tekst zamiast liczby odrzucony", (await v({ dzialanie: "dodaj", liczby: ["2+2"] })).success === false);
  check("Schemat: kod JS jako działanie odrzucony", (await v({ dzialanie: "process.exit()", liczby: [1, 2] })).success === false);
  check("Schemat: dodatkowe pole (wyrazenie) odrzucone", (await v({ dzialanie: "dodaj", liczby: [1, 2], wyrazenie: "1+1" })).success === false);
  check("Schemat: Infinity odrzucone", (await v({ dzialanie: "dodaj", liczby: [1, Infinity] })).success === false);
  check("Schemat: poprawne dane przyjęte", (await v({ dzialanie: "dodaj", liczby: [1, 2] })).success === true);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. czas ===");
{
  const london = timeIn(undefined, NOW);
  check("Domyślnie Europe/London: 12.11.2026, czwartek, 18:30", london.ok && london.strefa === "Europe/London" && london.data === "12.11.2026" && london.dzienTygodnia === "czwartek" && london.godzina === "18:30", JSON.stringify(london));
  const warsaw = timeIn("Europe/Warsaw", NOW);
  check("Europe/Warsaw: 19:30", warsaw.ok && warsaw.godzina === "19:30");
  const tokyo = timeIn("Asia/Tokyo", NOW);
  check("Asia/Tokyo: 13.11.2026, 03:30", tokyo.ok && tokyo.data === "13.11.2026" && tokyo.godzina === "03:30");
  const bad = timeIn("Mars/Olympus", NOW);
  check("Nieznana strefa → komunikat po polsku", !bad.ok && bad.komunikat.includes("Nie znam strefy czasowej „Mars/Olympus”"));
  const v = czas.inputSchema.validate;
  check("Schemat: bez strefy przyjęty", (await v({})).success === true);
  check("Schemat: strefa z kodem odrzucona", (await v({ strefa: "Europe/London'); alert(1)//" })).success === false);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. notatki (pamięć serwera, osobno dla sesji) ===");
{
  const store = new Map();
  const a1 = runNotes(store, "sesjaA", { akcja: "zapisz", tresc: "  Zadzwonić w piątek  " }, NOW);
  check("Zapis notatki (bez spacji na brzegach)", a1.ok && a1.akcja === "zapisz" && a1.zapisano.tresc === "Zadzwonić w piątek" && a1.zapisano.nr === 1);
  check("Odpowiedź zawiera uwagę, że notatki są tymczasowe", a1.ok && /tymczasowe/.test(a1.uwaga));
  runNotes(store, "sesjaA", { akcja: "zapisz", tresc: "Kod SW19" }, NOW);
  const listA = runNotes(store, "sesjaA", { akcja: "pokaz" }, NOW);
  check("Pokaż: 2 notatki sesji A", listA.ok && listA.notatki.length === 2);
  const listB = runNotes(store, "sesjaB", { akcja: "pokaz" }, NOW);
  check("Sesja B nie widzi notatek sesji A", listB.ok && listB.notatki.length === 0);
  check("Pusta notatka → komunikat", !runNotes(store, "sesjaA", { akcja: "zapisz", tresc: "   " }, NOW).ok);
  for (let i = 0; i < MAX_NOTES - 2; i++) runNotes(store, "sesjaC", { akcja: "zapisz", tresc: `n${i}` }, NOW);
  runNotes(store, "sesjaC", { akcja: "zapisz", tresc: "a" }, NOW);
  runNotes(store, "sesjaC", { akcja: "zapisz", tresc: "b" }, NOW);
  const over = runNotes(store, "sesjaC", { akcja: "zapisz", tresc: "51." }, NOW);
  check(`Limit ${MAX_NOTES} notatek → komunikat`, !over.ok && over.komunikat.includes("limit 50") && store.get("sesjaC").length === 50);
  const v = createNotesTool("x", new Map()).inputSchema.validate;
  check(`Schemat: notatka > ${MAX_NOTE_CHARS} znaków odrzucona`, (await v({ akcja: "zapisz", tresc: "a".repeat(501) })).success === false);
  check("Schemat: 500 znaków przyjęte", (await v({ akcja: "zapisz", tresc: "a".repeat(500) })).success === true);
  check("Schemat: nieznana akcja (usun) odrzucona", (await v({ akcja: "usun" })).success === false);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. diagnostyka (tylko „konfiguracja kompletna: tak/nie”) ===");
const FAKE_ENV = { OPENROUTER_API_KEY: "sk-or-TEST-SEKRET-123", OPENROUTER_MODEL: "google/gemini-test", CHAT_PASSWORD: "", SESSION_SECRET: "tajne-xyz" };
{
  const d = diagnostics({ env: FAKE_ENV }, NOW);
  check("Pusta zmienna → konfiguracja kompletna: nie", d.konfiguracjaKompletna === "nie");
  const full = diagnostics({ env: { ...FAKE_ENV, CHAT_PASSWORD: "x" } }, NOW);
  check("Wszystkie ustawione → konfiguracja kompletna: tak", full.konfiguracjaKompletna === "tak");
  check("Brak zmiennych → konfiguracja kompletna: nie", diagnostics({ env: {} }, NOW).konfiguracjaKompletna === "nie");
  const json = JSON.stringify(d) + JSON.stringify(full);
  check("Wynik NIE zawiera wartości sekretów", !json.includes("sk-or-TEST") && !json.includes("tajne-xyz"), json);
  check("Wynik NIE zawiera nazw zmiennych środowiskowych", !/OPENROUTER|CHAT_PASSWORD|SESSION_SECRET|API_KEY/.test(json));
  check("Wynik NIE zawiera modelu, listy narzędzi ani limitu kroków", !/gemini|model|narzedzia|limitKrokow/.test(json), json);
  check("Tylko pola: konfiguracjaKompletna + pobrano (godzina sprawdzenia)", Object.keys(d).sort().join() === "konfiguracjaKompletna,pobrano" && d.pobrano === "12.11.2026, 18:30:05");
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. Agent: wszystkie narzędzia, etykiety, podpis historii ===");
const AUTH = { password: "test-haslo", secret: "test-secret-tools-".padEnd(64, "t") };
const TOKEN = createSessionToken(AUTH);
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
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
      return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "google/gemini-test", timestamp: new Date(0) }, ...chunks]) };
    },
  });
}
const call = (id, toolName, input) => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });
const NOTES = new Map();
const API_FETCH = fakeFetch([
  ["geocoding-api", GEO],
  ["api.open-meteo.com/v1/forecast", FORECAST],
  ["/rates/A/EUR/", EUR],
  ["date.nager.at", [{ date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day" }]],
  ["pl.wikipedia.org", { type: "standard", title: "Alarm", extract: "Alarm – sygnał…", content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Alarm" } } }],
]);
let lastSessionId = null;
function handler(model) {
  return createAgentHandler({
    getSession: (req) => {
      const token = readCookie(req, SESSION_COOKIE);
      return token && isSessionValid(token, AUTH) ? { secret: AUTH.secret, token } : null;
    },
    createModels: ({ sessionId }) => {
      lastSessionId = sessionId;
      const opts = { fetch: API_FETCH, now };
      const tools = {
        sprawdzObszar,
        informacjeOUrzadzeniu,
        pogoda: createWeatherTool(opts),
        waluty: createCurrencyTool(opts),
        swieta: createHolidaysTool(opts),
        wikipedia: createWikipediaTool(opts),
        kalkulator,
        czas,
        notatki: createNotesTool(sessionId, NOTES),
        diagnostyka: createDiagnosticsTool({ env: FAKE_ENV }),
      };
      return { model, tools };
    },
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput,
    maxTextChars: MAX_USER_MESSAGE_CHARS,
    maxRetries: 0,
    now: () => NOW,
    log: () => {},
  });
}
const request = (body, cookie = COOKIE) =>
  new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function readChat(response) {
  const raw = await response.text();
  const chunks = raw.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
  let message;
  for await (const m of readUIMessageStream({ stream: streamOf(chunks) })) message = m;
  return { raw, message: { ...message, role: "assistant" } };
}
const user = (id, text) => ({ id, role: "user", parts: [{ type: "text", text }] });
const output = (message, name) => message.parts.find((p) => p.type === `tool-${name}`)?.output;

{
  let r = await handler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: [user("u1", "pogoda")] }, ""));
  check("Bez sesji → 401 (nowe narzędzia nie zmieniają kolejności)", r.status === 401);

  const model = chatModel([
    [
      call("c1", "czas", { strefa: "Europe/Warsaw" }),
      call("c2", "pogoda", { miasto: "Londyn", data: "2026-11-13" }),
      call("c3", "waluty", { waluta: "eur", kwota: 100 }),
      call("c4", "swieta", { kraj: "gb", rok: 2026 }),
      toolCallsFinish,
    ],
    [
      call("c5", "wikipedia", { haslo: "Alarm" }),
      call("c6", "kalkulator", { dzialanie: "procent", liczby: [20, 666] }),
      call("c7", "notatki", { akcja: "zapisz", tresc: "Oddzwonić w piątek" }),
      call("c8", "diagnostyka", {}),
      toolCallsFinish,
    ],
    [...textChunks("Gotowe – oto wyniki."), stop],
  ]);
  const { message, raw } = await readChat(await handler(model)(request({ mode: "chat", messages: [user("u1", "Test wszystkich narzędzi")] })));
  const tools = message.metadata?.tools ?? [];
  check("Etykiety: wszystkie 8 nowych narzędzi", JSON.stringify(tools) === JSON.stringify(["czas", "pogoda", "waluty", "swieta", "wikipedia", "kalkulator", "notatki", "diagnostyka"]), JSON.stringify(tools));
  check("Etykiety są na liście dozwolonych w historii", tools.every((t) => HISTORY_TOOL_NAMES.includes(t)));
  check("Wyniki narzędzi dotarły do przeglądarki", output(message, "czas")?.strefa === "Europe/Warsaw" && output(message, "pogoda")?.opis === "deszcz" && output(message, "waluty")?.kwotaPLN === 425.12 && output(message, "swieta")?.kraj === "GB" && output(message, "wikipedia")?.tytul === "Alarm" && output(message, "kalkulator")?.wynik === 133.2, JSON.stringify(["czas","pogoda","waluty","swieta","wikipedia","kalkulator"].map((n) => output(message, n))));
  check("Notatka zapisana w sesji użytkownika", NOTES.get(lastSessionId)?.[0]?.tresc === "Oddzwonić w piątek" && lastSessionId === sessionIdFromToken(TOKEN));
  check("Diagnostyka w czacie: tylko konfiguracja kompletna (tak/nie) + godzina", JSON.stringify(Object.keys(output(message, "diagnostyka") ?? {}).sort()) === '["konfiguracjaKompletna","pobrano"]' && output(message, "diagnostyka")?.konfiguracjaKompletna === "nie");
  check("Strumień do przeglądarki NIE zawiera wartości ani nazw zmiennych", !raw.includes("sk-or-TEST") && !raw.includes("tajne-xyz") && !/OPENROUTER_API_KEY|SESSION_SECRET|CHAT_PASSWORD/.test(raw));
  const sentTools = model.doStreamCalls[0].tools.map((t) => t.name).sort();
  check("Model dostał narzędzia z opisami (bez aktualnyCzas)", sentTools.includes("czas") && !sentTools.includes("aktualnyCzas") && model.doStreamCalls[0].tools.every((t) => t.description && t.description.length > 40), sentTools.join());
  check("Odpowiedź podpisana", typeof message.metadata?.sig === "string");
  const toolParts = message.parts.filter((p) => p.type.startsWith("tool-")).length;
  check("Części narzędzi: 8 (limit historii 10)", toolParts === 8, String(toolParts));

  // Kolejna tura z tą odpowiedzią w historii – podpis i części narzędzi przyjęte.
  const next = chatModel([[call("c9", "notatki", { akcja: "pokaz" }), toolCallsFinish], [...textChunks("Masz 1 notatkę."), stop]]);
  const r2 = await handler(next)(request({ mode: "chat", messages: [user("u1", "Test wszystkich narzędzi"), message, user("u2", "Pokaż notatki")] }));
  check("Historia z nowymi narzędziami → podpis przyjęty (200)", r2.status === 200);
  const { message: m2 } = await readChat(r2);
  check("Notatki widoczne w kolejnej turze tej sesji", output(m2, "notatki")?.notatki?.length === 1);
  const sentToModel = JSON.stringify(next.doStreamCalls[0].prompt);
  check("Wyniki narzędzi z historii NIE trafiają do modelu (tylko tekst)", !sentToModel.includes("425.12") && sentToModel.includes("Gotowe – oto wyniki."));
}
{
  // Złe dane wejściowe → tool-input-error, rozmowa toczy się dalej.
  const model = chatModel([
    [call("e1", "kalkulator", { dzialanie: "eval", liczby: [1] }), call("e2", "waluty", { waluta: "EURO" }), toolCallsFinish],
    [...textChunks("Przepraszam, podaj poprawne dane."), stop],
  ]);
  const e = console.error; console.error = () => {}; // oczekiwane wpisy w logu serwera o złych danych
  const { message } = await readChat(await handler(model)(request({ mode: "chat", messages: [user("u1", "policz eval")] })));
  console.error = e;
  const errs = message.parts.filter((p) => p.type.startsWith("tool-") && p.state === "output-error");
  check("Złe dane → błąd wejścia narzędzia (nie wykonane)", errs.length === 2, JSON.stringify(message.parts.map((p) => [p.type, p.state])));
  check("Model dostał komunikat i odpowiedział – rozmowa działa dalej", message.parts.some((p) => p.type === "text" && p.text.includes("Przepraszam")) && typeof message.metadata?.sig === "string");
}
{
  // Komunikat API (ok:false) – zwykły wynik, bez błędu aplikacji.
  const model = chatModel([[call("m1", "pogoda", { miasto: "Xyzabc" }), toolCallsFinish], [...textChunks("Nie znalazłam takiego miasta."), stop]]);
  const f = createWeatherTool({ fetch: fakeFetch([["geocoding-api", { results: [] }]]), now });
  const h = createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({ model, tools: { pogoda: f } }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
  });
  const res = await h(request({ mode: "chat", messages: [user("u1", "pogoda w Xyzabc")] }));
  const { message } = await readChat(res);
  check("Brak miasta: status 200, wynik z komunikatem po polsku", res.status === 200 && output(message, "pogoda")?.ok === false && /Nie znalazłam miasta/.test(output(message, "pogoda")?.komunikat));
  check("Model dostał komunikat jako wynik narzędzia", JSON.stringify(model.doStreamCalls[1].prompt).includes("Nie znalazłam miasta"));
}

console.log("\n=== 10. Limit narzędzi w jednej odpowiedzi (warstwy A, B, C) ===");
check(`Limit wywołań = limit części w historii (${MAX_AGENT_TOOL_PARTS})`, AGENT_TOOL_CALL_LIMIT === MAX_AGENT_TOOL_PARTS && AGENT_TOOL_SOFT_LIMIT === 8);
{
  const b = createToolBudget(10);
  const res = Array.from({ length: 12 }, (_, i) => b.admit(`p${i}`, "pogoda"));
  check("Budżet: z 12 wywołań innych niż obraz przyjęte 9 (1 miejsce dla obrazu)", res.filter(Boolean).length === 9 && res.slice(0, 9).every(Boolean) && !res[9]);
  check("Budżet: decyzja stała dla tego samego wywołania", b.admit("p0", "pogoda") === true && b.admit("p11", "pogoda") === false);
  check("Budżet: obraz nadal przyjęty (zarezerwowane miejsce)", b.admit("img", "generujObraz") === true && b.admit("img2", "generujObraz") === false && b.admitted === 10);
}
const CITIES = ["Londyn", "Warszawa", "Paryż", "Berlin", "Madryt", "Rzym", "Wiedeń", "Praga", "Oslo", "Dublin", "Lizbona", "Ateny"];
const executedCities = [];
const countingWeather = () => {
  const t = createWeatherTool({ fetch: API_FETCH, now });
  return { ...t, execute: async (input, o) => { executedCities.push(input.miasto); return t.execute(input, o); } };
};
function image() {
  const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new MockImageModelV4({ modelId: IMAGE_MODEL_ID, doGenerate: async () => ({ images: [PNG_1PX], warnings: [], response: { timestamp: new Date(0), modelId: IMAGE_MODEL_ID, headers: {} } }) });
}
function limitHandler(model, extraTools = {}) {
  return createAgentHandler({
    getSession: (req) => {
      const token = readCookie(req, SESSION_COOKIE);
      return token && isSessionValid(token, AUTH) ? { secret: AUTH.secret, token } : null;
    },
    createModels: () => ({ model, tools: { pogoda: countingWeather(), czas, generujObraz: createImageTool({ model: image(), maxRetries: 0 }), ...extraTools } }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
  });
}
{
  // 12 równoczesnych wywołań pogody w jednym kroku.
  executedCities.length = 0;
  const model = chatModel([
    [...CITIES.map((m, i) => call(`w${i}`, "pogoda", { miasto: m, data: "2026-11-13" })), toolCallsFinish],
    [...textChunks("Prognoza dla 9 miast. Dla Dublina, Lizbony i Aten zapytaj w kolejnej wiadomości."), stop],
  ]);
  const res = await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Pogoda w 12 miastach")] }));
  const { message, raw } = await readChat(res);
  const parts = message.parts.filter((p) => p.type.startsWith("tool-"));
  check("12 wywołań: status 200, odpowiedź podpisana", res.status === 200 && typeof message.metadata?.sig === "string");
  check("12 wywołań: przeglądarka dostała 9 części (≤ 10)", parts.length === 9, String(parts.length));
  check("12 wywołań: wykonano dokładnie 9 (te same co pokazane)", executedCities.length === 9 && parts.every((p) => executedCities.includes(p.input?.miasto)), executedCities.join());
  check("12 wywołań: każda pokazana część ma pełny wynik", parts.every((p) => p.state === "output-available" && p.output?.ok === true));
  check("12 wywołań: niewykonane (w9–w11) nie są w przeglądarce", !raw.includes('"w9"') && !raw.includes('"w10"') && !raw.includes('"w11"'));
  const prompt2 = JSON.stringify(model.doStreamCalls[1].prompt);
  check("12 wywołań: model dostał 9 wyników i 3 komunikaty o pominięciu (bez danych pogody)",
    (prompt2.match(/Pominięto: osiągnięto limit narzędzi/g) ?? []).length === 3 && (prompt2.match(/Open-Meteo/g) ?? []).length === 9);
  check("12 wywołań: etykieta pogoda (tylko wykonane narzędzia)", JSON.stringify(message.metadata?.tools) === JSON.stringify(["pogoda"]));
  check("Warstwa B: po 8 wywołaniach kolejny krok bez narzędzi (toolChoice: none)", model.doStreamCalls[1].toolChoice?.type === "none", JSON.stringify(model.doStreamCalls[1].toolChoice));
  check("Historia serwera (pełne części) też przechodzi kontrolę", checkChatHistory([user("u1", "Pogoda w 12 miastach"), message, user("u2", "Dalej")], { key: deriveHistoryKey(AUTH.secret), sessionId: sessionIdFromToken(TOKEN) }).ok === true);

  // Kolejna wiadomość w tej samej rozmowie – tak jak wysyła przeglądarka (prepareAgentMessages).
  const sent = prepareAgentMessages([user("u1", "Pogoda w 12 miastach"), message, user("u2", "A Dublin, Lizbona i Ateny?")]);
  check("Warstwa C: przeglądarka odsyła odpowiedź bez części narzędzi", !sent[1].parts.some((p) => p.type.startsWith("tool-")) && sent[1].metadata?.sig === message.metadata.sig);
  check("Warstwa C: widok rozmowy bez zmian (części zostają w przeglądarce)", message.parts.filter((p) => p.type.startsWith("tool-")).length === 9);
  executedCities.length = 0;
  const model2 = chatModel([
    [call("x1", "pogoda", { miasto: "Dublin", data: "2026-11-13" }), call("x2", "pogoda", { miasto: "Lizbona", data: "2026-11-13" }), call("x3", "pogoda", { miasto: "Ateny", data: "2026-11-13" }), toolCallsFinish],
    [...textChunks("Oto prognoza dla pozostałych trzech miast."), stop],
  ]);
  const r2 = await limitHandler(model2)(request({ mode: "chat", messages: sent }));
  const { message: m2 } = await readChat(r2);
  check("Kolejna wiadomość: 200, nowy limit (3 wywołania wykonane)", r2.status === 200 && executedCities.length === 3 && m2.parts.filter((p) => p.type === "tool-pogoda").length === 3);
  check("Kolejna wiadomość: odpowiedź podpisana", typeof m2.metadata?.sig === "string");
  const prompt = JSON.stringify(model2.doStreamCalls[0].prompt);
  check("Kolejna wiadomość: model widzi wcześniejszą odpowiedź (ciągłość)", prompt.includes("Prognoza dla 9 miast."));
  // Trzecia tura – cała historia (2 odpowiedzi) nadal poprawna, także w pełnej postaci.
  const sent3 = prepareAgentMessages([...sent, m2, user("u3", "Dziękuję")]);
  const r3 = await limitHandler(chatModel([[...textChunks("Proszę bardzo."), stop]]))(request({ mode: "chat", messages: sent3 }));
  check("Trzecia wiadomość w tej samej rozmowie → 200", r3.status === 200);
  const r3full = await limitHandler(chatModel([[...textChunks("Proszę bardzo."), stop]]))(request({ mode: "chat", messages: [user("u1", "Pogoda w 12 miastach"), message, user("u2", "A Dublin, Lizbona i Ateny?"), m2, user("u3", "Dziękuję")] }));
  check("Ta sama rozmowa z pełnymi częściami (stara przeglądarka) → 200", r3full.status === 200);
}
{
  // Obraz + 11 innych wywołań – obraz zawsze ma miejsce i jest pokazany.
  executedCities.length = 0;
  const model = chatModel([
    [...CITIES.slice(0, 11).map((m, i) => call(`w${i}`, "pogoda", { miasto: m })), call("img", "generujObraz", { opis: "Kamera CCTV na ścianie domu" }), toolCallsFinish],
    [...textChunks("Obraz jest gotowy."), stop],
  ]);
  const { message } = await readChat(await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Proszę wygenerować obraz: kamera CCTV")] })));
  const img = message.parts.find((p) => p.type === "tool-generujObraz");
  check("Obraz + 11 innych: obraz wygenerowany i pokazany", img?.state === "output-available" && img?.output?.ok === true, JSON.stringify(img?.output)?.slice(0, 80));
  check("Obraz + 11 innych: razem 10 części (9 + obraz)", message.parts.filter((p) => p.type.startsWith("tool-")).length === 10 && executedCities.length === 9);
  check("Obraz + 11 innych: etykiety pogoda i generujObraz", JSON.stringify(message.metadata?.tools) === JSON.stringify(["pogoda", "generujObraz"]));
  const sent = prepareAgentMessages([user("u1", "Proszę wygenerować obraz: kamera CCTV"), message, user("u2", "Dziękuję")]);
  check("Warstwa C: część obrazu zostaje (bez danych obrazu)", sent[1].parts.filter((p) => p.type.startsWith("tool-")).length === 1 && JSON.stringify(sent[1].parts.find((p) => p.type === "tool-generujObraz").output) === '{"ok":true}');
  const r2 = await limitHandler(chatModel([[...textChunks("Proszę."), stop]]))(request({ mode: "chat", messages: sent }));
  check("Kolejna wiadomość po obrazie → 200", r2.status === 200);
}
{
  // Wywołania rozłożone na kroki: 3 + 3 + 3 → po 9 (≥ 8) model nie dostaje już narzędzi.
  const steps = [0, 1, 2].map((k) => [...[0, 1, 2].map((i) => call(`s${k}${i}`, "czas", {})), toolCallsFinish]);
  const model = chatModel([...steps, [...textChunks("Gotowe."), stop]]);
  const { message } = await readChat(await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Godzina?")] })));
  check("Kroki 3+3: trzeci krok jeszcze z narzędziami (6 < 8)", model.doStreamCalls[2].toolChoice?.type !== "none");
  check("Po 9 wywołaniach czwarty krok bez narzędzi", model.doStreamCalls[3].toolChoice?.type === "none");
  check("9 części, odpowiedź podpisana", message.parts.filter((p) => p.type === "tool-czas").length === 9 && typeof message.metadata?.sig === "string");
}
{
  // Odpowiedź z samymi narzędziami (bez tekstu, np. limit kroków) – po warstwie C nadal poprawna.
  const model = chatModel([[call("c1", "czas", {}), toolCallsFinish]]);
  const loop = chatModel(Array.from({ length: 5 }, (_, k) => [call(`l${k}`, "czas", {}), toolCallsFinish]));
  const { message } = await readChat(await limitHandler(loop)(request({ mode: "chat", messages: [user("u1", "x")] })));
  const sent = prepareAgentMessages([user("u1", "x"), message, user("u2", "y")]);
  check("Odpowiedź bez tekstu: po warstwie C pusty tekst zamiast części", sent[1].parts.some((p) => p.type === "text") && !sent[1].parts.some((p) => p.type.startsWith("tool-")));
  const r2 = await limitHandler(model)(request({ mode: "chat", messages: sent }));
  check("Odpowiedź bez tekstu: kolejna wiadomość → 200", r2.status === 200, String(r2.status));
}
{
  // Ręcznie dopisane części (11) nadal odrzucane – kontrola serwera bez zmian.
  const msg = { id: "a1", role: "assistant", parts: [{ type: "text", text: "x" }], metadata: { kind: "chat", sig: "zly" } };
  for (let i = 0; i < 11; i++) msg.parts.push({ type: "tool-czas", toolCallId: `c${i}` });
  const e = console.warn; console.warn = () => {};
  const r = await limitHandler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: [user("u1", "x"), msg, user("u2", "y")] }));
  console.warn = e;
  check("11 dopisanych części → nadal 400 (zabezpieczenie bez zmian)", r.status === 400);
  check("Komunikat o pominięciu po polsku", TOOL_SKIPPED_MESSAGE.startsWith("Pominięto: osiągnięto limit narzędzi"));
}

console.log("\n=== 11. Wikipedia jako źródło, dane dostawcy poza przeglądarką ===");
{
  const WIKI = { type: "standard", title: "Telewizja przemysłowa", extract: "CCTV – system kamer.", content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Telewizja_przemys%C5%82owa" } } };
  const wikiTool = createWikipediaTool({ fetch: fakeFetch([["pl.wikipedia.org", WIKI]]), now });
  const SECRET_THOUGHT = "MYSL-MODELU-123";
  const pm = { openrouter: { reasoning_details: [{ type: "reasoning.text", text: SECRET_THOUGHT }, { type: "reasoning.encrypted", data: "ZASZYFROWANE-XYZ" }] } };
  const model = chatModel([
    [{ ...call("k1", "wikipedia", { haslo: "Telewizja przemysłowa" }), providerMetadata: pm }, toolCallsFinish],
    [{ type: "text-start", id: "t1", providerMetadata: pm }, { type: "text-delta", id: "t1", delta: "Telewizja przemysłowa to system kamer.", providerMetadata: pm }, { type: "text-end", id: "t1", providerMetadata: pm }, stop],
  ]);
  const h = createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({ model, tools: { wikipedia: wikiTool, czas } }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
  });
  const res = await h(request({ mode: "chat", messages: [user("u1", "Co to jest telewizja przemysłowa?")] }));
  const { message, raw } = await readChat(res);
  const src = message.parts.filter((p) => p.type === "source-url");
  check("Wikipedia: link jako źródło pod odpowiedzią", src.length === 1 && src[0].url === "https://pl.wikipedia.org/wiki/Telewizja_przemys%C5%82owa" && src[0].title === "Wikipedia: Telewizja przemysłowa", JSON.stringify(src));
  check("Wikipedia: link NIE jest wpisany w treść odpowiedzi", !message.parts.filter((p) => p.type === "text").some((p) => p.text.includes("http")));
  check("Etykiety: tylko wikipedia (bez „wyszukiwanie”)", JSON.stringify(message.metadata?.tools) === '["wikipedia"]', JSON.stringify(message.metadata?.tools));
  check("Godzina pobrania przy źródłach (fetchedAt)", message.metadata?.fetchedAt === "12.11.2026, 18:30");
  check("Strumień: brak reasoning_details i providerMetadata", !raw.includes("reasoning_details") && !raw.includes("providerMetadata") && !raw.includes(SECRET_THOUGHT) && !raw.includes("ZASZYFROWANE-XYZ"));
  check("Strumień: brak danych dostawcy (openrouter)", !raw.includes('"openrouter"'));
  const p2 = JSON.stringify(model.doStreamCalls[1].prompt);
  check("Wewnątrz serwera dane rozumowania zostają (drugi krok modelu je dostał)", p2.includes(SECRET_THOUGHT) && p2.includes("ZASZYFROWANE-XYZ"));
  // Kolejne wiadomości w tej samej rozmowie (podpis ze źródłem z Wikipedii).
  const sent = prepareAgentMessages([user("u1", "Co to jest telewizja przemysłowa?"), message, user("u2", "Dziękuję")]);
  check("Źródło Wikipedii zostaje w wysyłanej historii", sent[1].parts.some((p) => p.type === "source-url"));
  const next = chatModel([[...textChunks("Proszę bardzo."), stop]]);
  const r2 = await h(request({ mode: "chat", messages: sent }));
  check("Kolejna wiadomość po odpowiedzi ze źródłem Wikipedii → 200", r2.status === 200);
  const { message: m2 } = await readChat(r2);
  const r3 = await h(request({ mode: "chat", messages: [...sent, m2, user("u3", "A jeszcze raz?")] }));
  check("Trzecia wiadomość → 200 (ciągłość rozmowy)", r3.status === 200);
  // Zmieniony adres źródła → podpis nie pasuje → 400.
  const tampered = JSON.parse(JSON.stringify(sent));
  tampered[1].parts.find((p) => p.type === "source-url").url = "https://evil.example.com/";
  const e = console.warn; console.warn = () => {};
  const r4 = await h(request({ mode: "chat", messages: tampered }));
  console.warn = e;
  check("Podmieniony link źródła → 400 (podpis HMAC działa)", r4.status === 400);
  void next;
}
{
  // Link spoza pl.wikipedia.org nie staje się źródłem; błąd hasła → bez źródła.
  const bad = createWikipediaTool({ fetch: fakeFetch([["pl.wikipedia.org", { type: "standard", title: "X", extract: "x", content_urls: { desktop: { page: "https://evil.example.com/x" } } }]]), now });
  const none = createWikipediaTool({ fetch: fakeFetch([]), now });
  for (const [name, t] of [["obcy link", bad], ["brak hasła", none]]) {
    const model = chatModel([[call("k1", "wikipedia", { haslo: "X" }), toolCallsFinish], [...textChunks("Odpowiedź."), stop]]);
    const h = createAgentHandler({
      getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
      createModels: () => ({ model, tools: { wikipedia: t } }),
      instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
      history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
      generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
    });
    const { message } = await readChat(await h(request({ mode: "chat", messages: [user("u1", "X")] })));
    check(`Wikipedia (${name}) → bez źródła, odpowiedź podpisana`, !message.parts.some((p) => p.type === "source-url") && typeof message.metadata?.sig === "string");
  }
}

console.log("\n=== 12. Instrukcje ===");
check("Instrukcja: tylko informacje z narzędzi, regiony tylko gdy zwrócone", /Podawaj wyłącznie informacje zwrócone przez narzędzia – nie uzupełniaj ich własną wiedzą\. Przy świętach podawaj regiony tylko wtedy, gdy zwróci je narzędzie\./.test(AMBER_CHAT_INSTRUCTIONS));
check("Instrukcja: zakres święta tylko z pola ogolnokrajowe (true/false), bez zgadywania", /ogólnokrajowym tylko przy ogolnokrajowe: true, a regionalnym tylko przy ogolnokrajowe: false; gdy narzędzie nie poda tego pola, nie określaj/.test(AMBER_CHAT_INSTRUCTIONS));
check("Instrukcja: link z Wikipedii pod odpowiedzią, nie w treści", /Link do artykułu z Wikipedii aplikacja pokazuje pod odpowiedzią/.test(AMBER_CHAT_INSTRUCTIONS));
check("Ogólny zakaz wpisywania adresów stron bez zmian", AMBER_CHAT_INSTRUCTIONS.includes("Nie wpisuj adresów stron do odpowiedzi – źródła pokazuje aplikacja pod odpowiedzią."));
check("Sekcja NARZĘDZIA POMOCNICZE w trybie czatu", AMBER_CHAT_INSTRUCTIONS.includes("NARZĘDZIA POMOCNICZE:"));
check("Brak tej sekcji w trybie analizy", !AMBER_ANALYZE_INSTRUCTIONS.includes("NARZĘDZIA POMOCNICZE:"));
check("Ceny/usługi/zasady wyłącznie z bazy wiedzy", /cenach, usługach, terminach, rabatach i zasadach .* wyłącznie z tej instrukcji/.test(AMBER_CHAT_INSTRUCTIONS));
check("Produkcja: instrukcja czatu bez słowa „diagnostyk”", !/diagnostyk/i.test(AMBER_CHAT_INSTRUCTIONS));
check("Wersja testowa: instrukcja o diagnostyce – tylko „konfiguracja kompletna: tak/nie”", /Przekaż wyłącznie informację „konfiguracja kompletna: tak\/nie”/.test(AMBER_CHAT_INSTRUCTIONS_DEV) && AMBER_CHAT_INSTRUCTIONS_DEV.includes("DIAGNOSTYKA (ŚRODOWISKO TESTOWE):") && AMBER_CHAT_INSTRUCTIONS_DEV.startsWith(AMBER_CHAT_INSTRUCTIONS) && !/OPENROUTER|SESSION_SECRET|CHAT_PASSWORD/.test(AMBER_CHAT_INSTRUCTIONS_DEV));
check("Instrukcja: co zrobić, gdy narzędzie pominięto z powodu limitu", /pominięte z powodu limitu narzędzi/.test(AMBER_CHAT_INSTRUCTIONS));
{
  const route = readFileSync(new URL("../app/api/agent/route.ts", import.meta.url), "utf8");
  check("route.ts: diagnostyka tylko gdy NODE_ENV === \"development\"", /const DEV_DIAGNOSTICS = process\.env\.NODE_ENV === "development";/.test(route) && /if \(DEV_DIAGNOSTICS\) \{\s*\/\/[^\n]*\n\s*tools\.diagnostyka = createDiagnosticsTool\(\{ env: process\.env \}\);/.test(route) && (route.match(/createDiagnosticsTool\(/g) ?? []).length === 1);
  check("route.ts: instrukcja testowa tylko w trybie dev", /chat: DEV_DIAGNOSTICS \? AMBER_CHAT_INSTRUCTIONS_DEV : AMBER_CHAT_INSTRUCTIONS/.test(route));
}
check("Notatki opisane jako tymczasowe", /Notatki są tymczasowe/.test(AMBER_CHAT_INSTRUCTIONS) && /Nigdy nie przedstawiaj ich jako trwałej pamięci/.test(AMBER_CHAT_INSTRUCTIONS));
check("DATA I GODZINA: narzędzie czas (domyślnie Londyn)", /Masz narzędzie czas .*Europe\/London/.test(AMBER_CHAT_INSTRUCTIONS) && !AMBER_CHAT_INSTRUCTIONS.includes("aktualnyCzas"));
check("Ceny w bazie wiedzy bez zmian (£666 + VAT)", AMBER_CHAT_INSTRUCTIONS.includes("£666"));

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
