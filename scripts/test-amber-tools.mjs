// Testy lekcji 4: osiem narzędzi pomocniczych + przestepczosc (Warsztat 1, Fast) – BEZ internetu (sztuczny fetch) i BEZ OpenRouter (sztuczny model).
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-tools.mjs

import { jsonSchema, readUIMessageStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { readFileSync } from "node:fs";
import {
  AGENT_STEP_LIMIT,
  AGENT_TASK_SOFT_DEADLINE_MS,
  AGENT_TASK_TIMEOUT_MS,
  AGENT_TOOL_TIMEOUT_MS,
  SOURCE_TIMEOUT_MESSAGE,
  TOOL_REPEAT_MESSAGE,
  TOOL_TIMEOUT_EXCLUDED,
  taskTimeoutMessage,
  AGENT_TOOL_CALL_LIMIT,
  AGENT_TOOL_SOFT_LIMIT,
  TOOL_SKIPPED_MESSAGE,
  createAgentHandler,
  createToolBudget,
  buildStepLimitSummary,
  stepLimitMessage,
} from "../lib/amber-agent.ts";
import { MockImageModelV4 } from "ai/test";
import { IMAGE_MODEL_ID, createImageTool } from "../lib/amber-image.ts";
import { buildStepList, formatAgentStats, formatStepList, markStoppedQuestion, prepareAgentMessages, STEP_LIMIT_MESSAGE, STOPPED_TASK_NOTE } from "../lib/amber-chat-client.ts";
import { SESSION_COOKIE, createSessionToken, isSessionValid, readCookie } from "../lib/auth.ts";
import { AMBER_ANALYZE_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS, AMBER_CHAT_INSTRUCTIONS_DEV } from "../lib/amber-instructions.ts";
import { generateAmberOutput } from "../lib/amber-output.ts";
import { checkArea, informacjeOUrzadzeniu, sprawdzObszar } from "../lib/amber-tools.ts";
import {
  CRIME_CATEGORY_LABELS,
  CRIME_EMPTY_NOTE,
  CRIME_MESSAGES,
  CRIME_NOTE,
  CRIME_RADIUS,
  CRIME_SOURCE,
  CRIME_TIMEOUT_MS,
  countCrimes,
  createCrimeTool,
  crimeMonthLabel,
  getCrimeStats,
  SOURCE_TIMEOUT,
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
  // Poprawka: tabela B tylko po 404 z tabeli A; inne błędy bez przejścia do B; kursy starsze niż 14 dni odrzucane.
  const USD_A = { table: "A", currency: "dolar amerykański", code: "USD", rates: [{ effectiveDate: "2026-11-12", mid: 3.9676 }] };
  const USD_B_OLD = { table: "B", currency: "dolar", code: "USD", rates: [{ effectiveDate: "2004-04-28", mid: 4.011 }] };
  {
    const f = fakeFetch([["/rates/A/USD/", USD_A], ["/rates/B/USD/", USD_B_OLD]]);
    const r = await getCurrency({ waluta: "USD" }, { fetch: f, now });
    check("Tabela A odpowiada → kurs z tabeli A, bez zapytania do B", r.ok && r.tabela === "A" && r.kursPLN === 3.9676 && f.calls.length === 1, JSON.stringify(r));
  }
  for (const [name, reply] of [["HTTP 500", status(500)], ["HTTP 503", status(503)], ["HTTP 429", status(429)], ["brak sieci", networkDown], ["zły JSON", new Response("<html>", { status: 200 })], ["timeout", neverAnswers]]) {
    const f = fakeFetch([["/rates/A/USD/", reply], ["/rates/B/USD/", USD_B_OLD]]);
    const r = await getCurrency({ waluta: "USD" }, { fetch: f, now, timeoutMs: 30 });
    // Warsztat 2 (Standard, D3): przekroczony czas → „Źródło nie odpowiada (NBP).”; inne błędy bez zmian.
    const expected = name === "timeout" ? "Źródło nie odpowiada (NBP)." : "Serwis NBP nie odpowiada. Spróbuj ponownie za chwilę.";
    check(`Tabela A: ${name} → „${expected}”, BEZ przejścia do tabeli B`, !r.ok && r.komunikat === expected && f.calls.length === 1 && !f.calls.some((c) => c.url.includes("/rates/B/")), `${f.calls.length} zapytań: ${r.komunikat}`);
  }
  {
    const f = fakeFetch([["/rates/A/USD/", { table: "A", code: "USD", rates: [] }], ["/rates/B/USD/", USD_B_OLD]]);
    const r = await getCurrency({ waluta: "USD" }, { fetch: f, now });
    check("Tabela A: odpowiedź bez kursu → „NBP nie odpowiada”, bez tabeli B", !r.ok && r.komunikat.includes("NBP nie odpowiada") && f.calls.length === 1);
  }
  {
    const f = fakeFetch([["/rates/B/AFN/", { table: "B", currency: "afgani", code: "AFN", rates: [{ effectiveDate: "2026-11-11", mid: 0.0551 }] }]]);
    const r = await getCurrency({ waluta: "AFN" }, { fetch: f, now });
    check("Tabela A 404 → tabela B (aktualny kurs przyjęty)", r.ok && r.tabela === "B" && f.calls.length === 2 && f.calls[0].url.includes("/rates/A/") && f.calls[1].url.includes("/rates/B/"));
    const f2 = fakeFetch([["/rates/B/AFN/", status(500)]]);
    const r2 = await getCurrency({ waluta: "AFN" }, { fetch: f2, now });
    check("Tabela A 404, tabela B błąd → „NBP nie odpowiada”", !r2.ok && r2.komunikat.includes("NBP nie odpowiada"));
  }
  {
    const f = fakeFetch([["/rates/B/USD/", USD_B_OLD]]);
    const r = await getCurrency({ waluta: "USD" }, { fetch: f, now });
    check("Kurs starszy niż 14 dni (2004-04-28) → odrzucony z komunikatem po polsku", !r.ok && r.komunikat === "Najnowszy kurs waluty „USD” w NBP pochodzi z 2004-04-28 (starszy niż 14 dni), więc nie podaję go jako aktualnego.", r.komunikat);
    const old15 = fakeFetch([["/rates/A/EUR/", { ...EUR, rates: [{ effectiveDate: "2026-10-28", mid: 4.3 }] }]]);
    check("Kurs sprzed 15 dni → odrzucony", !(await getCurrency({ waluta: "EUR" }, { fetch: old15, now })).ok);
    const ok14 = fakeFetch([["/rates/A/EUR/", { ...EUR, rates: [{ effectiveDate: "2026-10-29", mid: 4.3 }] }]]);
    check("Kurs sprzed dokładnie 14 dni → przyjęty", (await getCurrency({ waluta: "EUR" }, { fetch: ok14, now })).ok === true);
    const badDate = fakeFetch([["/rates/A/EUR/", { ...EUR, rates: [{ effectiveDate: "wczoraj", mid: 4.3 }] }]]);
    check("Zła data kursu → „NBP nie odpowiada”", !(await getCurrency({ waluta: "EUR" }, { fetch: badDate, now })).ok);
    const badMid = fakeFetch([["/rates/A/EUR/", { ...EUR, rates: [{ effectiveDate: "2026-11-12", mid: -1 }] }]]);
    check("Ujemny kurs → „NBP nie odpowiada”", !(await getCurrency({ waluta: "EUR" }, { fetch: badMid, now })).ok);
  }
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
  // Warsztat 2 (Standard): liczniki (metadata.stats) służą tylko do wyświetlenia – przeglądarka nie odsyła ich
  // w historii (prepareAgentMessages), więc tu też je oddzielamy. Serwer odrzuca historię z polem stats (test niżej).
  const { stats, ...metadata } = message?.metadata ?? {};
  return { raw, stats, message: { ...message, role: "assistant", ...(message?.metadata ? { metadata } : {}) } };
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
// Warsztat 2 (Standard, D1): limit 16 wywołań na zadanie, warstwa B po 14.
check(`Limit wywołań = limit części w historii (${MAX_AGENT_TOOL_PARTS})`, AGENT_TOOL_CALL_LIMIT === MAX_AGENT_TOOL_PARTS && AGENT_TOOL_CALL_LIMIT === 16 && AGENT_TOOL_SOFT_LIMIT === 14);
{
  const b = createToolBudget(10);
  const res = Array.from({ length: 12 }, (_, i) => b.admit(`p${i}`, "pogoda"));
  check("Budżet: z 12 wywołań innych niż obraz przyjęte 9 (1 miejsce dla obrazu)", res.filter(Boolean).length === 9 && res.slice(0, 9).every(Boolean) && !res[9]);
  check("Budżet: decyzja stała dla tego samego wywołania", b.admit("p0", "pogoda") === true && b.admit("p11", "pogoda") === false);
  check("Budżet: obraz nadal przyjęty (zarezerwowane miejsce)", b.admit("img", "generujObraz") === true && b.admit("img2", "generujObraz") === false && b.admitted === 10);
}
// 20 miast: 15 wykonanych (16. miejsce zarezerwowane dla obrazu), 5 pominiętych.
const CITIES = ["Londyn", "Warszawa", "Paryż", "Berlin", "Madryt", "Rzym", "Wiedeń", "Praga", "Oslo", "Bruksela", "Amsterdam", "Kopenhaga", "Sztokholm", "Helsinki", "Budapeszt", "Dublin", "Lizbona", "Ateny", "Wilno", "Ryga"];
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
  // 20 równoczesnych wywołań pogody w jednym kroku.
  executedCities.length = 0;
  const model = chatModel([
    [...CITIES.map((m, i) => call(`w${i}`, "pogoda", { miasto: m, data: "2026-11-13" })), toolCallsFinish],
    [...textChunks("Prognoza dla 15 miast. Dla Dublina, Lizbony, Aten, Wilna i Rygi zapytaj w kolejnej wiadomości."), stop],
  ]);
  const res = await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Pogoda w 20 miastach")] }));
  const { message, raw, stats } = await readChat(res);
  const parts = message.parts.filter((p) => p.type.startsWith("tool-"));
  check("20 wywołań: status 200, odpowiedź podpisana", res.status === 200 && typeof message.metadata?.sig === "string");
  check("20 wywołań: przeglądarka dostała 15 części (≤ 16)", parts.length === 15, String(parts.length));
  check("20 wywołań: wykonano dokładnie 15 (te same co pokazane)", executedCities.length === 15 && parts.every((p) => executedCities.includes(p.input?.miasto)), executedCities.join());
  check("20 wywołań: każda pokazana część ma pełny wynik", parts.every((p) => p.state === "output-available" && p.output?.ok === true));
  check("20 wywołań: niewykonane (w15–w19) nie są w przeglądarce", ["w15", "w16", "w17", "w18", "w19"].every((id) => !raw.includes(`"${id}"`)));
  const prompt2 = JSON.stringify(model.doStreamCalls[1].prompt);
  check("20 wywołań: model dostał 15 wyników i 5 komunikatów o pominięciu (bez danych pogody)",
    (prompt2.match(/Pominięto: osiągnięto limit narzędzi/g) ?? []).length === 5 && (prompt2.match(/Open-Meteo/g) ?? []).length === 15);
  check("20 wywołań: etykieta pogoda (tylko wykonane narzędzia)", JSON.stringify(message.metadata?.tools) === JSON.stringify(["pogoda"]));
  check("20 wywołań: liczniki – 2 kroki modelu, 15 wywołań narzędzi", stats?.kroki === 2 && stats?.narzedzia === 15, JSON.stringify(stats));
  check("Warstwa B: po 14 wywołaniach kolejny krok bez narzędzi (toolChoice: none)", model.doStreamCalls[1].toolChoice?.type === "none", JSON.stringify(model.doStreamCalls[1].toolChoice));
  check("Historia serwera (pełne części) też przechodzi kontrolę", checkChatHistory([user("u1", "Pogoda w 20 miastach"), message, user("u2", "Dalej")], { key: deriveHistoryKey(AUTH.secret), sessionId: sessionIdFromToken(TOKEN) }).ok === true);

  // Kolejna wiadomość w tej samej rozmowie – tak jak wysyła przeglądarka (prepareAgentMessages).
  const sent = prepareAgentMessages([user("u1", "Pogoda w 20 miastach"), message, user("u2", "A Dublin, Lizbona i Ateny?")]);
  check("Warstwa C: przeglądarka odsyła odpowiedź bez części narzędzi", !sent[1].parts.some((p) => p.type.startsWith("tool-")) && sent[1].metadata?.sig === message.metadata.sig);
  check("Warstwa C: widok rozmowy bez zmian (części zostają w przeglądarce)", message.parts.filter((p) => p.type.startsWith("tool-")).length === 15);
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
  check("Kolejna wiadomość: model widzi wcześniejszą odpowiedź (ciągłość)", prompt.includes("Prognoza dla 15 miast."));
  // Trzecia tura – cała historia (2 odpowiedzi) nadal poprawna, także w pełnej postaci.
  const sent3 = prepareAgentMessages([...sent, m2, user("u3", "Dziękuję")]);
  const r3 = await limitHandler(chatModel([[...textChunks("Proszę bardzo."), stop]]))(request({ mode: "chat", messages: sent3 }));
  check("Trzecia wiadomość w tej samej rozmowie → 200", r3.status === 200);
  const r3full = await limitHandler(chatModel([[...textChunks("Proszę bardzo."), stop]]))(request({ mode: "chat", messages: [user("u1", "Pogoda w 20 miastach"), message, user("u2", "A Dublin, Lizbona i Ateny?"), m2, user("u3", "Dziękuję")] }));
  check("Ta sama rozmowa z pełnymi częściami (stara przeglądarka) → 200", r3full.status === 200);
}
{
  // Obraz + 19 innych wywołań – obraz zawsze ma miejsce i jest pokazany.
  executedCities.length = 0;
  const model = chatModel([
    [...CITIES.slice(0, 19).map((m, i) => call(`w${i}`, "pogoda", { miasto: m })), call("img", "generujObraz", { opis: "Kamera CCTV na ścianie domu" }), toolCallsFinish],
    [...textChunks("Obraz jest gotowy."), stop],
  ]);
  const { message } = await readChat(await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Proszę wygenerować obraz: kamera CCTV")] })));
  const img = message.parts.find((p) => p.type === "tool-generujObraz");
  check("Obraz + 19 innych: obraz wygenerowany i pokazany", img?.state === "output-available" && img?.output?.ok === true, JSON.stringify(img?.output)?.slice(0, 80));
  check("Obraz + 19 innych: razem 16 części (15 + obraz)", message.parts.filter((p) => p.type.startsWith("tool-")).length === 16 && executedCities.length === 15);
  check("Obraz + 19 innych: etykiety pogoda i generujObraz", JSON.stringify(message.metadata?.tools) === JSON.stringify(["pogoda", "generujObraz"]));
  const sent = prepareAgentMessages([user("u1", "Proszę wygenerować obraz: kamera CCTV"), message, user("u2", "Dziękuję")]);
  check("Warstwa C: część obrazu zostaje (bez danych obrazu)", sent[1].parts.filter((p) => p.type.startsWith("tool-")).length === 1 && JSON.stringify(sent[1].parts.find((p) => p.type === "tool-generujObraz").output) === '{"ok":true}');
  const r2 = await limitHandler(chatModel([[...textChunks("Proszę."), stop]]))(request({ mode: "chat", messages: sent }));
  check("Kolejna wiadomość po obrazie → 200", r2.status === 200);
}
{
  // Wywołania rozłożone na kroki: 5 + 5 + 5 → po 15 (≥ 14) model nie dostaje już narzędzi.
  const steps = [0, 1, 2].map((k) => [...[0, 1, 2, 3, 4].map((i) => call(`s${k}${i}`, "czas", {})), toolCallsFinish]);
  const model = chatModel([...steps, [...textChunks("Gotowe."), stop]]);
  const { message, stats } = await readChat(await limitHandler(model)(request({ mode: "chat", messages: [user("u1", "Godzina?")] })));
  check("Kroki 5+5: trzeci krok jeszcze z narzędziami (10 < 14)", model.doStreamCalls[2].toolChoice?.type !== "none");
  check("Po 15 wywołaniach czwarty krok bez narzędzi", model.doStreamCalls[3].toolChoice?.type === "none");
  check("15 części, odpowiedź podpisana", message.parts.filter((p) => p.type === "tool-czas").length === 15 && typeof message.metadata?.sig === "string");
  check("Liczniki: 4 kroki modelu, 15 wywołań narzędzi (limit kroków 6 liczony osobno)", stats?.kroki === 4 && stats?.narzedzia === 15, JSON.stringify(stats));
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

console.log("\n=== 13. ReAct: limit 6 kroków, podsumowanie, lista kroków ===");
function reactHandler(model, { stepLimit, tools } = {}) {
  return createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({
      model,
      tools: tools ?? {
        pogoda: createWeatherTool({ fetch: API_FETCH, now }),
        waluty: createCurrencyTool({ fetch: API_FETCH, now }),
        kalkulator,
        czas,
      },
    }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
    ...(stepLimit ? { stepLimit } : {}),
  });
}
const textOf = (m) => m.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
check("AGENT_STEP_LIMIT = 6", AGENT_STEP_LIMIT === 6);
check("Komunikat dokładnie „Zatrzymałem się po 6 krokach”", stepLimitMessage(6) === "Zatrzymałem się po 6 krokach");
check("Instrukcja: sekcja PRACA KROK PO KROKU", /PRACA KROK PO KROKU:\n- Przy zadaniu złożonym pracuj krok po kroku: użyj narzędzia, przeczytaj wynik i dopiero wtedy zdecyduj o następnym kroku\.\n- Nie zgaduj danych, które możesz sprawdzić narzędziem\./.test(AMBER_CHAT_INSTRUCTIONS));
check("Instrukcja ReAct tylko w czacie (nie w analizie)", !AMBER_ANALYZE_INSTRUCTIONS.includes("PRACA KROK PO KROKU"));
{
  // Pętla, która ciągle chce narzędzi: 6 różnych miast, potem nadal chce dalej.
  const cities = ["Londyn", "Warszawa", "Paryż", "Berlin", "Madryt", "Rzym", "Wiedeń"];
  const model = chatModel(cities.map((m, i) => [call(`r${i}`, "pogoda", { miasto: m, data: "2026-11-13" }), toolCallsFinish]));
  const res = await reactHandler(model)(request({ mode: "chat", messages: [user("u1", "Pogoda w wielu miastach")] }));
  const { message, raw } = await readChat(res);
  const text = textOf(message);
  check("Limit: dokładnie 6 kroków modelu", model.doStreamCalls.length === 6, String(model.doStreamCalls.length));
  check("Limit: wszystkie 6 kroków mogło użyć narzędzi (toolChoice nie „none”)", model.doStreamCalls.every((c) => c.toolChoice?.type !== "none"));
  check("Limit: tekst zaczyna się od „Zatrzymałem się po 6 krokach. Udało się ustalić:”", text.startsWith("Zatrzymałem się po 6 krokach. Udało się ustalić:"), text.slice(0, 60));
  const lines = text.split("\n").filter((l) => l.startsWith("– "));
  check("Podsumowanie: 6 rzeczywistych wyników (szósty krok też)", lines.length === 6 && lines.every((l) => l.startsWith("– pogoda (")), JSON.stringify(lines));
  check("Podsumowanie z danych narzędzia (Londyn, 13.11: 3,4–9,8°C, deszcz, 6,2 mm)", lines[0] === "– pogoda (Londyn, 2026-11-13): 3,4–9,8°C, deszcz, opady 6,2 mm", lines[0]);
  check("Podsumowanie bez 7. miasta (nie wykonano)", !text.includes("Wiedeń"));
  check("Limit: odpowiedź podpisana, status 200", res.status === 200 && typeof message.metadata?.sig === "string");
  check("Lista kroków: 1. pogoda → … → 6. pogoda", formatStepList(buildStepList(message)) === "1. pogoda → 2. pogoda → 3. pogoda → 4. pogoda → 5. pogoda → 6. pogoda", formatStepList(buildStepList(message)));
  check("finishReason „tool-calls”, ale tekst jest – bez dodatkowego komunikatu przeglądarki", raw.includes('"finishReason":"tool-calls"') && text.length > 0 && STEP_LIMIT_MESSAGE.includes("6 kroków"));
  // Kolejne wiadomości w tej samej rozmowie.
  const sent = prepareAgentMessages([user("u1", "Pogoda w wielu miastach"), message, user("u2", "A Wiedeń?")]);
  const model2 = chatModel([[call("v1", "pogoda", { miasto: "Wiedeń", data: "2026-11-13" }), toolCallsFinish], [...textChunks("W Wiedniu deszcz."), stop]]);
  const r2 = await reactHandler(model2)(request({ mode: "chat", messages: sent }));
  const { message: m2 } = await readChat(r2);
  check("Po limicie: kolejna wiadomość → 200, nowy licznik kroków (2 kroki)", r2.status === 200 && model2.doStreamCalls.length === 2 && textOf(m2) === "W Wiedniu deszcz.");
  check("Model widzi podsumowanie z poprzedniej odpowiedzi (ciągłość)", JSON.stringify(model2.doStreamCalls[0].prompt).includes("Zatrzymałem się po 6 krokach"));
  const r3 = await reactHandler(chatModel([[...textChunks("Proszę."), stop]]))(request({ mode: "chat", messages: prepareAgentMessages([...sent, m2, user("u3", "Dziękuję")]) }));
  check("Trzecia wiadomość → 200", r3.status === 200);
  // Podmienione podsumowanie → podpis HMAC nie pasuje.
  const forged = JSON.parse(JSON.stringify(sent));
  const tp = forged[1].parts.filter((p) => p.type === "text").pop();
  tp.text = tp.text.replace("Londyn", "Lizbona");
  const w = console.warn; console.warn = () => {};
  const r4 = await reactHandler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: forged }));
  console.warn = w;
  check("Podmienione podsumowanie → 400 (podpis HMAC)", r4.status === 400);
}
{
  // Wcześniejszy tekst modelu zostaje; podsumowanie tylko z wyników po tym tekście; bez powtórzeń.
  const steps = [
    [call("a1", "pogoda", { miasto: "Londyn", data: "2026-11-13" }), toolCallsFinish],
    [...textChunks("W Londynie jutro deszcz, 3,4–9,8°C. Sprawdzam dalej."), call("a2", "czas", {}), toolCallsFinish],
    [call("a3", "czas", {}), toolCallsFinish],
    [call("a4", "czas", {}), toolCallsFinish],
    [call("a5", "waluty", { waluta: "EUR" }), toolCallsFinish],
    [call("a6", "kalkulator", { dzialanie: "podziel", liczby: [1500, 4.2512] }), toolCallsFinish],
  ];
  const model = chatModel(steps);
  const { message } = await readChat(await reactHandler(model)(request({ mode: "chat", messages: [user("u1", "x")] })));
  const text = textOf(message);
  check("Wcześniejszy tekst modelu zachowany na początku", text.startsWith("W Londynie jutro deszcz, 3,4–9,8°C. Sprawdzam dalej.\n\nZatrzymałem się po 6 krokach. Udało się ustalić:"), text.slice(0, 90));
  check("Bez powtórzenia pogody (już opisanej przez model)", !text.includes("– pogoda ("));
  check("czas 3 razy z tymi samymi danymi → pokazany raz", (text.match(/– czas \(/g) ?? []).length === 1, text);
  check("waluty i kalkulator w podsumowaniu", text.includes("– waluty: 1 EUR = 4,2512 zł (NBP, 2026-11-12)") && text.includes("– kalkulator: podziel (1500; 4,2512) = 352,8416"), JSON.stringify(text));
  check("Lista kroków z tekstem: 1. pogoda → 2. czas → … → 6. kalkulator", formatStepList(buildStepList(message)) === "1. pogoda → 2. czas → 3. czas → 4. czas → 5. waluty → 6. kalkulator", formatStepList(buildStepList(message)));
}
{
  // Komunikat TYLKO przy rzeczywistym limicie: zakończenie w 1, 3 i dokładnie 6 krokach.
  for (const n of [1, 3, 6]) {
    const steps = [];
    for (let i = 0; i < n - 1; i++) steps.push([call(`e${n}${i}`, "czas", { strefa: ["Europe/London", "Europe/Warsaw", "Asia/Tokyo", "America/New_York", "Europe/Paris"][i] }), toolCallsFinish]);
    steps.push([...textChunks(`Gotowe po ${n} krokach.`), stop]);
    const model = chatModel(steps);
    const { message } = await readChat(await reactHandler(model)(request({ mode: "chat", messages: [user("u1", "x")] })));
    check(`Zakończenie w ${n} krok(ach) → bez komunikatu o zatrzymaniu`, model.doStreamCalls.length === n && textOf(message) === `Gotowe po ${n} krokach.` && !textOf(message).includes("Zatrzymałem"));
  }
}
{
  // Błędy narzędzi w podsumowaniu (złe dane, komunikat API) i brak wyników.
  const steps = Array.from({ length: 6 }, (_, i) => [
    // Warsztat 2 (Standard): różne dane – identycznego nieudanego wywołania agent już nie powtarza (test niżej).
    i === 0 ? call("x0", "waluty", { waluta: "EURO" }) : i === 1 ? call("x1", "pogoda", { miasto: "Xyzabc" }) : call(`x${i}`, "kalkulator", { dzialanie: "podziel", liczby: [i, 0] }),
    toolCallsFinish,
  ]);
  const errF = fakeFetch([["geocoding-api", { results: [] }]]);
  const model = chatModel(steps);
  const e = console.error; console.error = () => {};
  const { message } = await readChat(await reactHandler(model, { tools: { pogoda: createWeatherTool({ fetch: errF, now }), waluty: createCurrencyTool({ fetch: errF, now }), kalkulator } })(request({ mode: "chat", messages: [user("u1", "x")] })));
  console.error = e;
  const text = textOf(message);
  check("Błąd danych wejściowych w podsumowaniu", text.includes("– waluty: nieprawidłowe dane wejściowe – nie wykonano"), text);
  check("Komunikat API w podsumowaniu (brak miasta)", text.includes("– pogoda: Nie znalazłam miasta „Xyzabc”"));
  check("Komunikaty kalkulatora (4 różne dzielenia przez zero) w podsumowaniu", (text.match(/Nie można dzielić przez zero/g) ?? []).length === 4, text);
  const dup = { step: 0, name: "kalkulator", input: { dzialanie: "podziel", liczby: [1, 0] }, kind: "ok", output: { ok: false, komunikat: "Nie można dzielić przez zero." } };
  check("Podsumowanie: ten sam wynik (to samo narzędzie i dane) pokazany raz", (buildStepLimitSummary(6, [dup, { ...dup, step: 1 }, { ...dup, step: 2 }], false).match(/Nie można dzielić przez zero/g) ?? []).length === 1);
  check("Lista kroków z błędem: „1. waluty (błąd)”", formatStepList(buildStepList(message)).startsWith("1. waluty (błąd) → 2. pogoda → 3. kalkulator"), formatStepList(buildStepList(message)));
  check("Brak wyników → komunikat bez zmyślonych danych", buildStepLimitSummary(6, [], false) === "Zatrzymałem się po 6 krokach. Nie udało się jeszcze ustalić wyników – proszę zadać pytanie prościej lub w kilku częściach.");
  check("Pominięte przez limit narzędzi nie trafiają do podsumowania", buildStepLimitSummary(6, [{ step: 0, name: "pogoda", input: {}, kind: "ok", output: { ok: false, pominieto: true, komunikat: TOOL_SKIPPED_MESSAGE } }], false).startsWith("Zatrzymałem się po 6 krokach. Nie udało"));
}
{
  // Test z materiałów 1: łańcuch narzędzi – kurs EUR z NBP, potem 1500 PLN → EUR z użyciem tego kursu.
  let rateSeen = null;
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      step++;
      let chunks;
      if (step === 1) chunks = [call("n1", "waluty", { waluta: "EUR" }), toolCallsFinish];
      else if (step === 2) {
        // Model czyta wynik pierwszego kroku z rozmowy i używa go jako argumentu kalkulatora.
        const res = prompt.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c) => c.type === "tool-result" && c.toolName === "waluty");
        rateSeen = res?.output?.value?.kursPLN ?? null;
        chunks = [call("n2", "kalkulator", { dzialanie: "podziel", liczby: [1500, rateSeen] }), toolCallsFinish];
      } else chunks = [...textChunks("1500 PLN to ok. 352,84 EUR (kurs NBP 4,2512)."), stop];
      return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "google/gemini-test", timestamp: new Date(0) }, ...chunks]) };
    },
  });
  const { message } = await readChat(await reactHandler(model)(request({ mode: "chat", messages: [user("u1", "Ile euro dostanę za 1500 zł?")] })));
  const calc = message.parts.find((p) => p.type === "tool-kalkulator");
  check("Łańcuch: krok 2 dostał wynik kroku 1 (kurs 4,2512 z NBP)", rateSeen === 4.2512, String(rateSeen));
  check("Łańcuch: kalkulator użył kursu z NBP (1500 / 4,2512)", JSON.stringify(calc?.input?.liczby) === "[1500,4.2512]" && calc?.output?.wynik === Math.round((1500 / 4.2512) * 1e10) / 1e10, JSON.stringify(calc?.output));
  check("Łańcuch: lista kroków 1. waluty → 2. kalkulator", formatStepList(buildStepList(message)) === "1. waluty → 2. kalkulator");
  check("Łańcuch: zakończony wcześniej (3 kroki), bez komunikatu o limicie", model.doStreamCalls.length === 3 && !textOf(message).includes("Zatrzymałem"));
}
{
  // Test z materiałów 2: tymczasowy limit 2 kroków, porównanie pogody w czterech miastach.
  const model = chatModel([
    [call("p1", "pogoda", { miasto: "Londyn", data: "2026-11-13" }), toolCallsFinish],
    [call("p2", "pogoda", { miasto: "Warszawa", data: "2026-11-13" }), toolCallsFinish],
    [call("p3", "pogoda", { miasto: "Paryż", data: "2026-11-13" }), toolCallsFinish],
  ]);
  const { message } = await readChat(await reactHandler(model, { stepLimit: 2 })(request({ mode: "chat", messages: [user("u1", "Porównaj pogodę w Londynie, Warszawie, Paryżu i Berlinie")] })));
  const text = textOf(message);
  check("Limit 2: dokładnie 2 kroki", model.doStreamCalls.length === 2);
  check("Limit 2: „Zatrzymałem się po 2 krokach” + 2 częściowe wyniki", text.startsWith("Zatrzymałem się po 2 krokach. Udało się ustalić:") && text.split("\n").filter((l) => l.startsWith("– pogoda (")).length === 2, text);
  check("Limit 2: bez Paryża i Berlina (nie sprawdzone)", !text.includes("Paryż") && !text.includes("Berlin"));
  // Przywrócenie limitu 6 (domyślnego) – ta sama prośba dochodzi dalej.
  const model6 = chatModel([
    [call("q1", "pogoda", { miasto: "Londyn", data: "2026-11-13" }), toolCallsFinish],
    [call("q2", "pogoda", { miasto: "Warszawa", data: "2026-11-13" }), toolCallsFinish],
    [call("q3", "pogoda", { miasto: "Paryż", data: "2026-11-13" }), toolCallsFinish],
    [call("q4", "pogoda", { miasto: "Berlin", data: "2026-11-13" }), toolCallsFinish],
    [...textChunks("Porównanie czterech miast gotowe."), stop],
  ]);
  const { message: m6 } = await readChat(await reactHandler(model6)(request({ mode: "chat", messages: [user("u1", "Porównaj pogodę w czterech miastach")] })));
  check("Limit przywrócony (6): 5 kroków, zakończone bez komunikatu", model6.doStreamCalls.length === 5 && textOf(m6) === "Porównanie czterech miast gotowe.");
}
{
  // Lista kroków: kilka narzędzi w jednym kroku, wyszukiwanie, Wikipedia, starsza odpowiedź.
  const msg = { id: "m", role: "assistant", parts: [
    { type: "step-start" }, { type: "tool-czas", toolCallId: "1", state: "output-available" },
    { type: "step-start" }, { type: "tool-pogoda", toolCallId: "2", state: "output-available" }, { type: "tool-waluty", toolCallId: "3", state: "output-available" },
    { type: "step-start" }, { type: "source-url", sourceId: "s1", url: "https://example.org" },
    { type: "step-start" }, { type: "tool-wikipedia", toolCallId: "4", state: "output-available" }, { type: "source-url", sourceId: "wiki-4", url: "https://pl.wikipedia.org/wiki/X" },
    { type: "step-start" }, { type: "text", text: "Odpowiedź" },
  ] };
  check("Lista: kilka narzędzi w kroku, wyszukiwanie, Wikipedia nie jako wyszukiwanie", formatStepList(buildStepList(msg)) === "1. czas → 2. pogoda, waluty → 3. wyszukiwanie → 4. wikipedia", formatStepList(buildStepList(msg)));
  check("Lista: odpowiedź bez narzędzi → pusta", buildStepList({ id: "x", role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: "Hej" }] }).length === 0);
  check("Lista: starsza odpowiedź bez znaczników kroków", formatStepList(buildStepList({ id: "y", role: "assistant", parts: [{ type: "tool-czas", toolCallId: "1" }, { type: "text", text: "x" }] })) === "1. czas");
}

console.log("\n=== 12. Instrukcje ===");
check("Instrukcja: tylko informacje z narzędzi, regiony tylko gdy zwrócone", /Podawaj wyłącznie informacje zwrócone przez narzędzia – nie uzupełniaj ich własną wiedzą\. Przy świętach podawaj regiony tylko wtedy, gdy zwróci je narzędzie\./.test(AMBER_CHAT_INSTRUCTIONS));
check("Instrukcja: zakres święta tylko z pola ogolnokrajowe (true/false), bez zgadywania", /ogólnokrajowym tylko przy ogolnokrajowe: true, a regionalnym tylko przy ogolnokrajowe: false; gdy narzędzie nie poda tego pola, nie określaj/.test(AMBER_CHAT_INSTRUCTIONS));
check("Instrukcja: link z Wikipedii pod odpowiedzią, nie w treści", /Link do artykułu z Wikipedii aplikacja pokazuje pod odpowiedzią/.test(AMBER_CHAT_INSTRUCTIONS));
check("Ogólny zakaz wpisywania adresów stron bez zmian", AMBER_CHAT_INSTRUCTIONS.includes("Nie wpisuj adresów stron do odpowiedzi – źródła pokazuje aplikacja pod odpowiedzią."));
check("Sekcja NARZĘDZIA POMOCNICZE w trybie czatu", AMBER_CHAT_INSTRUCTIONS.includes("NARZĘDZIA POMOCNICZE:"));
check("Brak tej sekcji w trybie analizy", !AMBER_ANALYZE_INSTRUCTIONS.includes("NARZĘDZIA POMOCNICZE:"));
// Lekcja 6, Warsztat 3: w czacie baza wiedzy to dokumenty w Supabase (narzędzie searchKnowledge), nie treść instrukcji.
check("Ceny/usługi/zasady wyłącznie z bazy wiedzy", /cenach, usługach, terminach, rabatach i zasadach .* wyłącznie z bazy wiedzy \(narzędzie searchKnowledge\)/.test(AMBER_CHAT_INSTRUCTIONS));
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
// Lekcja 6: ceny są w dokumentach bazy wiedzy (czat) i nadal w instrukcji trybu analizy (bez narzędzi).
check("Ceny w bazie wiedzy bez zmian (£666 + VAT)", AMBER_ANALYZE_INSTRUCTIONS.includes("£666") && !AMBER_CHAT_INSTRUCTIONS.includes("£666"));

// ---------------------------------------------------------------------------
console.log("\n=== 14. przestepczosc (Warsztat 1, Fast): data.police.uk + postcodes.io ===");
{
  const DEPS = { areaCheck: checkArea };
  const PC = (postcode, extra = {}) => ({ status: 200, result: { postcode, latitude: 51.4214, longitude: -0.2064, country: "England", admin_district: "Merton", ...extra } });
  const LAST = { date: "2026-09-01" };
  const crime = (category, i) => ({
    category, persistent_id: `pid${i}`, id: 1000 + i, month: "2026-09", location_type: "Force", context: "",
    location: { latitude: "51.42", longitude: "-0.20", street: { id: 5, name: "On or near High Street" } },
    outcome_status: { category: "Under investigation", date: "2026-09" },
  });
  const CRIMES = [
    ...["anti-social-behaviour", "anti-social-behaviour", "anti-social-behaviour", "anti-social-behaviour"].map(crime),
    ...["burglary", "burglary", "burglary"].map(crime),
    ...["vehicle-crime", "vehicle-crime"].map(crime),
    crime("zupelnie-nowa-kategoria", 99),
    { category: "" }, null, { foo: 1 }, "tekst",
  ];
  const crimeFetch = (over = {}) => fakeFetch([
    ["api.postcodes.io/postcodes/", over.pc ?? PC("SW19 1AA")],
    ["data.police.uk/api/crime-last-updated", over.last ?? LAST],
    ["data.police.uk/api/crimes-street/all-crime", over.crimes ?? CRIMES],
  ]);
  const run = async (kod, over = {}, extra = {}) => {
    const f = crimeFetch(over);
    const r = await getCrimeStats({ kodPocztowy: kod }, { fetch: f, now, ...extra }, over.deps ?? DEPS);
    return { r, f, urls: f.calls.map((c) => c.url) };
  };

  // Poprawny wynik
  {
    const { r, f, urls } = await run("SW19 1AA");
    check("Pełny kod → ok, kod z postcodes.io, dzielnica, obszar działania (checkArea)",
      r.ok && r.kodPocztowy === "SW19 1AA" && r.obszar === "Merton" && r.obszarDzialaniaAmber === "w_obszarze" && r.typLokalizacji === "pełny kod pocztowy", JSON.stringify(r));
    check("Miesiąc z crime-last-updated: 2026-09 → „wrzesień 2026”", r.miesiac === "2026-09" && r.miesiacOpis === "wrzesień 2026");
    check("Liczenie: 10 zgłoszeń (wpisy bez kategorii pominięte)", r.lacznie === 10, String(r.lacznie));
    check("Kategorie po polsku, malejąco; nieznana → „inne przestępstwa”",
      JSON.stringify(r.kategorie) === JSON.stringify([
        { kategoria: "zachowania aspołeczne", liczba: 4 }, { kategoria: "włamania", liczba: 3 },
        { kategoria: "przestępstwa związane z pojazdami", liczba: 2 }, { kategoria: "inne przestępstwa", liczba: 1 },
      ]), JSON.stringify(r.kategorie));
    check("Promień, źródło (OGL), uwagi o dokładności, godzina pobrania",
      r.promien === CRIME_RADIUS && r.promien === "ok. 1 mila (ok. 1,6 km)" && r.zrodlo === CRIME_SOURCE && r.zrodlo.includes("Open Government Licence") &&
      r.uwagi === CRIME_NOTE && /przybliżone/.test(r.uwagi) && /opóźnieniem/.test(r.uwagi) && r.pobrano === "12.11.2026, 18:30:05");
    check("Dokładnie 3 zapytania HTTP", f.calls.length === 3, String(f.calls.length));
    check("postcodes.io: /postcodes/SW191AA (pełny kod, bez /outcodes/)", urls.includes("https://api.postcodes.io/postcodes/SW191AA") && !urls.some((u) => u.includes("/outcodes/")));
    check("crime-last-updated wywołany", urls.includes("https://data.police.uk/api/crime-last-updated"));
    check("crimes-street: date=RRRR-MM i współrzędne z postcodes.io (stały promień API, bez poly)",
      urls.includes("https://data.police.uk/api/crimes-street/all-crime?date=2026-09&lat=51.4214&lng=-0.2064") && !urls.some((u) => u.includes("poly=")), urls.join(" | "));
    check("Nagłówek Accept: application/json", f.calls.every((c) => c.init.headers.Accept === "application/json"));
    check("Wynik: tylko ustalone pola",
      JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["kategorie", "kodPocztowy", "lacznie", "miesiac", "miesiacOpis", "obszar", "obszarDzialaniaAmber", "ok", "pobrano", "promien", "typLokalizacji", "uwagi", "zrodlo"]));
    const json = JSON.stringify(r);
    check("Wynik BEZ nazw ulic, identyfikatorów, współrzędnych zdarzeń i wyników spraw",
      !json.includes("High Street") && !json.includes("pid") && !json.includes("1000") && !json.includes("Under investigation") && !json.includes("51.42\"") && !/street|outcome|persistent/i.test(json));
    check("Wynik BEZ słów ocennych (bezpieczeństwo, ryzyko, wysoka/niska)", !/bezpieczn|niebezpieczn|ryzyk|groźn|wysok|nisk|alarmując/i.test(json));
  }
  // Normalizacja i format kodu
  {
    const a = await run("sw19 1aa");
    const b = await run("  SW191AA ");
    check("Normalizacja: małe litery i spacje → ten sam adres postcodes.io", a.urls[0] === "https://api.postcodes.io/postcodes/SW191AA" && b.urls.includes("https://api.postcodes.io/postcodes/SW191AA") && a.r.ok && b.r.ok);
    for (const kod of ["SW19", "sw19", "EC1A", "M1"]) {
      const { r, f } = await run(kod);
      check(`Sama część kodu („${kod}”) → prośba o pełny kod, bez zapytań`, !r.ok && r.komunikat === CRIME_MESSAGES.outward && f.calls.length === 0, r.komunikat);
    }
    for (const kod of ["", "XYZ 123", "SW19 1A", "12345", "SW19 1AAA", "Londyn"]) {
      const { r, f } = await run(kod);
      check(`Zły format („${kod}”) → komunikat, bez zapytań`, !r.ok && r.komunikat === CRIME_MESSAGES.invalid && f.calls.length === 0 && typeof r.pobrano === "string", r.komunikat);
    }
  }
  // Obszar działania – ta sama funkcja checkArea co sprawdzObszar
  {
    for (const [kod, expected] of [["SW19 1AA", "w_obszarze"], ["EC1A 1BB", "w_obszarze"], ["KT1 1AA", "w_obszarze"], ["GU1 1AA", "do_potwierdzenia"], ["SL4 1NJ", "do_potwierdzenia"], ["M1 1AE", "poza_obszarem"], ["CF10 1AA", "poza_obszarem"], ["BT1 1AA", "poza_obszarem"]]) {
      const { r } = await run(kod, { pc: PC(kod) });
      check(`${kod}: obszarDzialaniaAmber = checkArea = ${expected}`, r.ok && r.obszarDzialaniaAmber === expected && checkArea(kod).wynik === expected, `${r.obszarDzialaniaAmber} / ${checkArea(kod).wynik}`);
    }
    const bad = await run("SW19 1AA", { deps: { areaCheck: () => { throw new Error("x"); } } });
    check("Błąd funkcji obszaru → „do_potwierdzenia” (bez wyjątku)", bad.r.ok && bad.r.obszarDzialaniaAmber === "do_potwierdzenia");
    const weird = await run("SW19 1AA", { deps: { areaCheck: () => ({ wynik: "nieprawidlowy_kod" }) } });
    check("Nieoczekiwany wynik obszaru → „do_potwierdzenia”", weird.r.obszarDzialaniaAmber === "do_potwierdzenia");
  }
  // Kraj i współrzędne
  {
    for (const country of ["Wales", "Northern Ireland"]) {
      const { r } = await run("CF10 1AA", { pc: PC("CF10 1AA", { country }) });
      check(`Kraj ${country} → dane dostępne`, r.ok);
    }
    for (const [name, extra] of [["Szkocja", { country: "Scotland" }], ["Wyspy Normandzkie", { country: "Channel Islands", latitude: null, longitude: null }], ["Wyspa Man", { country: "Isle of Man" }], ["brak współrzędnych", { latitude: null }], ["brak kraju", { country: undefined }]]) {
      const { r, urls } = await run("EH1 1YZ", { pc: PC("EH1 1YZ", extra) });
      check(`${name} → „dane policji obejmują tylko Anglię, Walię i Irlandię Północną”, bez crimes-street`, !r.ok && r.komunikat === CRIME_MESSAGES.notCovered && !urls.some((u) => u.includes("crimes-street")), r.komunikat);
    }
  }
  // Błędy postcodes.io
  {
    const nf = await run("SW19 9ZZ", { pc: new Response(JSON.stringify({ status: 404, error: "Postcode not found" }), { status: 404 }) });
    check("postcodes.io 404 (także kod wycofany) → „Nie znalazłam kodu pocztowego „SW19 9ZZ””, bez crimes-street",
      !nf.r.ok && nf.r.komunikat.startsWith("Nie znalazłam kodu pocztowego „SW19 9ZZ”") && !nf.urls.some((u) => u.includes("crimes-street")), nf.r.komunikat);
    for (const [name, pc] of [["500", status(500)], ["brak sieci", networkDown], ["zły JSON", new Response("<html>", { status: 200 })], ["brak pola result", { status: 200 }]]) {
      const { r } = await run("SW19 1AA", { pc });
      check(`postcodes.io: ${name} → „Serwis postcodes.io nie odpowiada”`, !r.ok && r.komunikat === "Serwis postcodes.io nie odpowiada. Spróbuj ponownie za chwilę.", r.komunikat);
    }
    const t0 = Date.now();
    const slow = await run("SW19 1AA", { pc: neverAnswers }, { timeoutMs: 40 });
    check("postcodes.io nie odpowiada → przerwanie po limicie czasu, „Źródło nie odpowiada (postcodes.io).”", !slow.r.ok && slow.r.komunikat === "Źródło nie odpowiada (postcodes.io)." && Date.now() - t0 < 1000, slow.r.komunikat);
  }
  // Błędy crime-last-updated
  for (const [name, last] of [["500", status(500)], ["429", status(429)], ["brak daty", {}], ["zła data", { date: "wczoraj" }], ["miesiąc 13", { date: "2026-13-01" }], ["brak sieci", networkDown]]) {
    const { r, urls } = await run("SW19 1AA", { last });
    check(`crime-last-updated: ${name} → „Serwis data.police.uk nie odpowiada”, bez crimes-street`, !r.ok && r.komunikat === "Serwis data.police.uk nie odpowiada. Spróbuj ponownie za chwilę." && !urls.some((u) => u.includes("crimes-street")), r.komunikat);
  }
  // Błędy crimes-street i brak danych
  {
    for (const [name, crimes] of [["503 (ponad 10 000 zgłoszeń)", status(503)], ["429 (limit zapytań)", status(429)], ["500", status(500)], ["zły JSON", new Response("nie json", { status: 200 })], ["obiekt zamiast listy", { error: "x" }], ["brak sieci", networkDown]]) {
      const { r } = await run("SW19 1AA", { crimes });
      check(`crimes-street: ${name} → komunikat po polsku`, !r.ok && r.komunikat === CRIME_MESSAGES.crimesUnavailable, r.komunikat);
    }
    const nf = await run("SW19 1AA", { crimes: status(404) });
    check("crimes-street 404 → „Brak danych policji za wrzesień 2026.”", !nf.r.ok && nf.r.komunikat === "Brak danych policji za wrzesień 2026.");
    const empty = await run("SW19 1AA", { crimes: [] });
    check("Pusta lista → ok, 0 zgłoszeń, uwaga, że nie musi to oznaczać braku przestępstw",
      empty.r.ok && empty.r.lacznie === 0 && empty.r.kategorie.length === 0 && empty.r.uwagi.includes(CRIME_EMPTY_NOTE) && empty.r.uwagi.includes(CRIME_NOTE));
  }
  // Czas: etap 1 równolegle, limit 6 s na zapytanie
  {
    const delayed = (ms, body) => () => new Promise((res) => setTimeout(() => res(new Response(JSON.stringify(body), { status: 200 })), ms));
    const t0 = Date.now();
    const { r } = await run("SW19 1AA", { pc: delayed(150, PC("SW19 1AA")), last: delayed(150, LAST) });
    const ms = Date.now() - t0;
    check("Etap 1 równolegle: postcodes.io i crime-last-updated (2 × 150 ms → < 290 ms)", r.ok && ms < 290, `${ms} ms`);
    check("Limit jednego zapytania: 6 s (2 etapy → najwyżej ok. 12 s)", CRIME_TIMEOUT_MS === 6000);
    const src = readFileSync(new URL("../lib/amber-tools-api.ts", import.meta.url), "utf8");
    check("Domyślnie używany limit CRIME_TIMEOUT_MS (wspólny helper bez zmian)", /timeoutMs: options\.timeoutMs \?\? CRIME_TIMEOUT_MS/.test(src) && /export const API_TIMEOUT_MS = 8000;/.test(src));
  }
  // Funkcje pomocnicze
  {
    const months = ["2027-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-10", "2026-11", "2026-12"].map(crimeMonthLabel);
    check("Nazwy miesięcy w mianowniku", JSON.stringify(months) === JSON.stringify(["styczeń 2027", "luty 2026", "marzec 2026", "kwiecień 2026", "maj 2026", "czerwiec 2026", "lipiec 2026", "sierpień 2026", "październik 2026", "listopad 2026", "grudzień 2026"]), JSON.stringify(months));
    check("Tabela kategorii: 14 kategorii data.police.uk (bez all-crime)", Object.keys(CRIME_CATEGORY_LABELS).length === 14 && !("all-crime" in CRIME_CATEGORY_LABELS) && CRIME_CATEGORY_LABELS.burglary === "włamania");
    const c = countCrimes([{ category: "robbery" }, { category: "burglary" }, { category: "robbery" }, { category: "burglary" }]);
    check("countCrimes: remis → alfabetycznie", JSON.stringify(c.kategorie.map((k) => k.kategoria)) === '["rozboje","włamania"]' && c.lacznie === 4);
  }
}

console.log("\n=== 15. przestepczosc w agencie: rejestracja, etykiety, podpis historii, ReAct ===");
{
  const DEPS = { areaCheck: checkArea };
  const CF = fakeFetch([
    ["api.postcodes.io/postcodes/", { status: 200, result: { postcode: "SW19 1AA", latitude: 51.4214, longitude: -0.2064, country: "England", admin_district: "Merton" } }],
    ["data.police.uk/api/crime-last-updated", { date: "2026-09-01" }],
    ["data.police.uk/api/crimes-street/all-crime", [{ category: "burglary" }, { category: "burglary" }, { category: "anti-social-behaviour" }]],
  ]);
  const crimeHandler = (model) => createAgentHandler({
    getSession: (req) => {
      const token = readCookie(req, SESSION_COOKIE);
      return token && isSessionValid(token, AUTH) ? { secret: AUTH.secret, token } : null;
    },
    createModels: () => ({ model, tools: { sprawdzObszar, przestepczosc: createCrimeTool({ fetch: CF, now }, DEPS) } }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
  });
  const before = CF.calls.length;
  const r401 = await crimeHandler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: [user("u1", "SW19 1AA")] }, ""));
  check("Bez sesji → 401, bez zapytań do data.police.uk", r401.status === 401 && CF.calls.length === before);

  // ReAct: krok 1 sprawdzObszar, krok 2 przestepczosc, krok 3 odpowiedź.
  const model = chatModel([
    [call("k1", "sprawdzObszar", { kodPocztowy: "SW19 1AA" }), toolCallsFinish],
    [call("k2", "przestepczosc", { kodPocztowy: "SW19 1AA" }), toolCallsFinish],
    [...textChunks("We wrześniu 2026 w promieniu ok. 1 mili zgłoszono 3 zdarzenia."), stop],
  ]);
  const { message } = await readChat(await crimeHandler(model)(request({ mode: "chat", messages: [user("u1", "Czy obsługujecie SW19 1AA i ile było tam włamań?")] })));
  const tools = message.metadata?.tools ?? [];
  check("Etykiety: sprawdzObszar, przestepczosc", JSON.stringify(tools) === '["sprawdzObszar","przestepczosc"]', JSON.stringify(tools));
  check("Etykieta przestepczosc na liście dozwolonych w historii", HISTORY_TOOL_NAMES.includes("przestepczosc"));
  const out = output(message, "przestepczosc");
  check("Wynik narzędzia w przeglądarce: 3 zgłoszenia, w_obszarze, wrzesień 2026", out?.ok === true && out.lacznie === 3 && out.obszarDzialaniaAmber === "w_obszarze" && out.miesiacOpis === "wrzesień 2026", JSON.stringify(out));
  check("ReAct: 3 kroki modelu (narzędzie → narzędzie → odpowiedź)", model.doStreamCalls.length === 3);
  check("Krok 3: model dostał wynik przestepczosc", JSON.stringify(model.doStreamCalls[2].prompt).includes("wrzesień 2026"));
  const steps = formatStepList(buildStepList(message));
  check("Lista kroków w czacie: sprawdzObszar → przestepczosc", /sprawdzObszar/.test(steps) && /przestepczosc/.test(steps) && steps.indexOf("sprawdzObszar") < steps.indexOf("przestepczosc"), steps);
  const sent = model.doStreamCalls[0].tools.find((t) => t.name === "przestepczosc");
  check("Model dostał narzędzie z opisem (pełny kod, neutralność)", sent && /PEŁNEGO/.test(sent.description) && /nie oceniaj/.test(sent.description));
  check("Odpowiedź podpisana", typeof message.metadata?.sig === "string");

  // Kolejna tura: podpis przyjęty, wyniki narzędzia NIE trafiają do modelu.
  const next = chatModel([[...textChunks("Proszę bardzo."), stop]]);
  const r2 = await crimeHandler(next)(request({ mode: "chat", messages: [user("u1", "Czy obsługujecie SW19 1AA i ile było tam włamań?"), message, user("u2", "Dziękuję")] }));
  check("Historia z tool-przestepczosc → podpis przyjęty (200)", r2.status === 200);
  await readChat(r2);
  const prompt2 = JSON.stringify(next.doStreamCalls[0].prompt.filter((m) => m.role !== "system"));
  check("Wyniki narzędzia z historii NIE trafiają do modelu", !prompt2.includes("obszarDzialaniaAmber") && !prompt2.includes("Merton") && !prompt2.includes("zachowania aspołeczne") && prompt2.includes("zgłoszono 3 zdarzenia"));
  const forged = JSON.parse(JSON.stringify(message));
  forged.metadata.tools = ["sprawdzObszar"];
  const r3 = await crimeHandler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: [user("u1", "Czy obsługujecie SW19 1AA i ile było tam włamań?"), forged, user("u2", "Dalej")] }));
  check("Sfałszowana lista narzędzi → odrzucona (400)", r3.status === 400);

  // Złe dane wejściowe → błąd wejścia, rozmowa toczy się dalej.
  const badModel = chatModel([[call("b1", "przestepczosc", { kodPocztowy: "SW19 1AA", admin: true }), toolCallsFinish], [...textChunks("Proszę o pełny kod."), stop]]);
  const e = console.error; console.error = () => {};
  const { message: mb } = await readChat(await crimeHandler(badModel)(request({ mode: "chat", messages: [user("u1", "przestępczość")] })));
  console.error = e;
  check("Dodatkowe pole w danych → błąd wejścia (narzędzie nie wykonane)", mb.parts.some((p) => p.type === "tool-przestepczosc" && p.state === "output-error"));

  // Podsumowanie po limicie kroków – z prawdziwego wyniku narzędzia.
  const summary = buildStepLimitSummary(AGENT_STEP_LIMIT, [{ step: 1, name: "przestepczosc", input: { kodPocztowy: "SW19 1AA" }, kind: "ok", output: out }], false);
  check("Podsumowanie ReAct zawiera wynik przestepczosc", summary.includes("przestepczosc (SW19 1AA, wrzesień 2026): 3 zgłoszeń w promieniu ok. 1 mila (ok. 1,6 km); w obszarze działania firmy"), summary);
  check("Limity agenta: 16 wywołań, 14 (miękki), 6 kroków (Warsztat 2 Standard)", AGENT_TOOL_CALL_LIMIT === 16 && AGENT_TOOL_SOFT_LIMIT === 14 && AGENT_STEP_LIMIT === 6);
  check("Limit części narzędzi w historii = limit wywołań (16)", MAX_AGENT_TOOL_PARTS === 16);

  const route = readFileSync(new URL("../app/api/agent/route.ts", import.meta.url), "utf8");
  check("route.ts: przestepczosc z checkArea (ta sama funkcja co sprawdzObszar)", route.includes("przestepczosc: createCrimeTool({}, { areaCheck: checkArea })") && /import \{ checkArea, informacjeOUrzadzeniu, sprawdzObszar \} from "\.\.\/\.\.\/\.\.\/lib\/amber-tools";/.test(route));
  const chatUi = readFileSync(new URL("../app/chat.tsx", import.meta.url), "utf8");
  check("Etykieta w czacie: „📊 przestepczosc”", chatUi.includes('przestepczosc: "📊 przestepczosc"'));

  // Instrukcja
  const I = AMBER_CHAT_INSTRUCTIONS;
  check("Instrukcja: sekcja STATYSTYKI PRZESTĘPCZOŚCI, tylko pełny kod", I.includes("STATYSTYKI PRZESTĘPCZOŚCI (narzędzie przestepczosc)") && I.includes("wyłącznie pełny brytyjski kod pocztowy") && I.includes("poproś o pełny kod pocztowy"));
  check("Instrukcja: wyraźna informacja przy poza_obszarem i do_potwierdzenia", /„poza_obszarem” napisz wyraźnie, że lokalizacja jest prawdopodobnie poza obszarem działania firmy/.test(I) && /„do_potwierdzenia” napisz, że obszar potwierdzi nasz zespół/.test(I));
  check("Instrukcja: neutralność – bez ocen, porównań, trendów i przewidywań", I.includes("Nie oceniaj bezpieczeństwa okolicy") && I.includes("Nie porównuj z innymi okolicami") && I.includes("nie wyciągaj wniosków o trendach") && I.includes("nie przewiduj przyszłości"));
  check("Instrukcja: bez straszenia i nacisku sprzedażowego, bez nazw ulic", I.includes("Nie strasz klienta") && I.includes("nakłaniania do zakupu") && I.includes("Nie podawaj nazw ulic"));
  check("Instrukcja: miesiąc, promień, źródło, przybliżone lokalizacje, opóźnienie", I.includes("miesiąc danych (miesiacOpis)") && I.includes("data.police.uk") && I.includes("lokalizacje w danych są przybliżone") && I.includes("z opóźnieniem"));
  check("Instrukcja testowa (dev) też zawiera zasady; analiza – nie", AMBER_CHAT_INSTRUCTIONS_DEV.includes("STATYSTYKI PRZESTĘPCZOŚCI") && !AMBER_ANALYZE_INSTRUCTIONS.includes("STATYSTYKI PRZESTĘPCZOŚCI"));
}

console.log("\n=== 16. Warsztat 2 – Standard: 16 wywołań, 60 s zadania, 10 s narzędzia, błędy, liczniki ===");
{
  check("Stałe: 60 s zadania, 45 s (bez nowych narzędzi), 10 s narzędzia", AGENT_TASK_TIMEOUT_MS === 60_000 && AGENT_TASK_SOFT_DEADLINE_MS === 45_000 && AGENT_TOOL_TIMEOUT_MS === 10_000);
  check("Limit 6 kroków modelu bez zmian; 16 wywołań narzędzi liczone osobno", AGENT_STEP_LIMIT === 6 && AGENT_TOOL_CALL_LIMIT === 16);
  check("Komunikat narzędzia po 10 s: „Źródło nie odpowiada”; generujObraz poza limitem 10 s", SOURCE_TIMEOUT_MESSAGE === "Źródło nie odpowiada" && TOOL_TIMEOUT_EXCLUDED.includes("generujObraz") && TOOL_TIMEOUT_EXCLUDED.length === 1);

  const stdHandler = (model, tools, extra = {}) => createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({ model, tools }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
    ...extra,
  });
  const ask = (h, text = "x") => h(request({ mode: "chat", messages: [user("u1", text)] }));
  const slowTool = (name, ms, out = { ok: true, wynik: "gotowe" }) => {
    const t = tool({
      description: `Testowe narzędzie ${name} (opóźnienie ${ms} ms) – tylko do testów automatycznych.`,
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      execute: async (_input, { abortSignal } = {}) => {
        t.calls = (t.calls ?? 0) + 1;
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(out), ms);
          abortSignal?.addEventListener("abort", () => { clearTimeout(timer); t.aborted = true; });
        });
      },
    });
    return t;
  };

  // 1. Limit 16 wywołań: 10 + 10 w dwóch krokach → 15 innych niż obraz wykonanych, 5 pominiętych; kroki liczone osobno.
  {
    const counted = [];
    const czasCounting = { ...czas, execute: async (input, o) => { counted.push(o.toolCallId); return czas.execute(input, o); } };
    const model = chatModel([
      [...Array.from({ length: 10 }, (_, i) => call(`a${i}`, "czas", { strefa: "Europe/London" })), toolCallsFinish],
      [...Array.from({ length: 10 }, (_, i) => call(`b${i}`, "czas", { strefa: "Europe/Warsaw" })), toolCallsFinish],
      [...textChunks("Gotowe."), stop],
    ]);
    const { message, stats } = await readChat(await ask(stdHandler(model, { czas: czasCounting })));
    check("16 wywołań: z 20 wykonano 15 (16. miejsce dla obrazu), część 15 w przeglądarce", counted.length === 15 && message.parts.filter((p) => p.type === "tool-czas").length === 15, String(counted.length));
    check("16 wywołań: drugi krok miał narzędzia (10 < 14), trzeci już nie", model.doStreamCalls[1].toolChoice?.type !== "none" && model.doStreamCalls[2].toolChoice?.type === "none");
    check("16 wywołań: liczniki 3 kroki modelu, 15 wywołań narzędzi", stats?.kroki === 3 && stats?.narzedzia === 15, JSON.stringify(stats));
  }

  // 2. Limit 10 s jednego narzędzia → „Źródło nie odpowiada” (skrócony limit testowy 60 ms).
  {
    const wolne = slowTool("czas", 5_000);
    const model = chatModel([[call("t1", "czas", {}), toolCallsFinish], [...textChunks("Nie udało się sprawdzić godziny – źródło nie odpowiada."), stop]]);
    const t0 = Date.now();
    const { message, stats } = await readChat(await ask(stdHandler(model, { czas: wolne }, { toolTimeoutMs: 60 })));
    const out = output(message, "czas");
    check("Narzędzie ponad limit czasu → wynik { ok: false, komunikat: „Źródło nie odpowiada” }", out?.ok === false && out?.komunikat === "Źródło nie odpowiada", JSON.stringify(out));
    check("Narzędzie przerwane (sygnał abort) i rozmowa trwa dalej", wolne.aborted === true && Date.now() - t0 < 2000 && typeof message.metadata?.sig === "string");
    check("Model dostał komunikat „Źródło nie odpowiada”", JSON.stringify(model.doStreamCalls[1].prompt).includes("Źródło nie odpowiada"));
    check("Liczniki: 2 kroki, 1 wywołanie (przekroczony czas też jest wywołaniem)", stats?.kroki === 2 && stats?.narzedzia === 1);
    const szybkie = slowTool("czas", 5);
    const m2 = chatModel([[call("t2", "czas", {}), toolCallsFinish], [...textChunks("OK"), stop]]);
    const { message: msg2 } = await readChat(await ask(stdHandler(m2, { czas: szybkie }, { toolTimeoutMs: 60 })));
    check("Narzędzie w limicie → zwykły wynik", output(msg2, "czas")?.wynik === "gotowe");
  }
  {
    // generujObraz poza limitem 10 s (obejmuje go limit 60 s zadania).
    const obraz = slowTool("generujObraz", 150, { ok: true, model: "test" });
    const model = chatModel([[call("g1", "generujObraz", {}), toolCallsFinish], [...textChunks("Obraz gotowy."), stop]]);
    const { message } = await readChat(await ask(stdHandler(model, { generujObraz: obraz }, { toolTimeoutMs: 60 })));
    check("generujObraz dłużej niż limit narzędzia → NIE przerwany (wynik ok)", output(message, "generujObraz")?.ok === true && !obraz.aborted);
  }
  {
    // Limit czasu zapytania API (getJson) → „Źródło nie odpowiada (nazwa źródła).”
    const r1 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", neverAnswers]]), now, timeoutMs: 30 });
    const r2 = await getWikipedia({ haslo: "Alarm" }, { fetch: fakeFetch([["wikipedia", neverAnswers]]), now, timeoutMs: 30 });
    const r3 = await getHolidays({ kraj: "GB", rok: 2026 }, { fetch: fakeFetch([["nager", neverAnswers]]), now, timeoutMs: 30 });
    check("getJson: przekroczony czas → „Źródło nie odpowiada (Open-Meteo).”", r1.komunikat === SOURCE_TIMEOUT("Open-Meteo") && r1.komunikat === "Źródło nie odpowiada (Open-Meteo).", r1.komunikat);
    check("getJson: przekroczony czas → Wikipedia i Nager.Date też", r2.komunikat === "Źródło nie odpowiada (Wikipedia)." && r3.komunikat === "Źródło nie odpowiada (Nager.Date).", `${r2.komunikat} | ${r3.komunikat}`);
    const r4 = await getWeather({ miasto: "Londyn" }, { fetch: fakeFetch([["geocoding-api", status(500)]]), now });
    check("Inny błąd (500) → dotychczasowy komunikat „Serwis … nie odpowiada”", r4.komunikat === "Serwis pogodowy Open-Meteo nie odpowiada. Spróbuj ponownie za chwilę.");
  }

  // 3. Błąd narzędzia: identyczne ponowne wywołanie nie jest wykonywane, kolejny krok bez narzędzi.
  {
    let runs = 0;
    const calc = { ...kalkulator, execute: async (input, o) => { runs++; return kalkulator.execute(input, o); } };
    const model = new MockLanguageModelV4({
      doStream: async ({ toolChoice }) => {
        const n = model.doStreamCalls.length;
        const chunks = n === 1 ? [call("p1", "kalkulator", { dzialanie: "podziel", liczby: [1, 0] }), toolCallsFinish]
          : n === 2 ? [call("p2", "kalkulator", { dzialanie: "podziel", liczby: [1, 0] }), toolCallsFinish]
          : [...textChunks(`Nie udało się obliczyć wyniku (dzielenie przez zero). [${toolChoice?.type}]`), stop];
        return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "m", timestamp: new Date(0) }, ...chunks]) };
      },
    });
    const { message, stats } = await readChat(await ask(stdHandler(model, { kalkulator: calc })));
    const parts = message.parts.filter((p) => p.type === "tool-kalkulator");
    check("Powtórzenie nieudanego wywołania: wykonane tylko raz", runs === 1, String(runs));
    check("Powtórzenie: model dostał komunikat o niepowtarzaniu", parts[1]?.output?.powtorzenie === true && parts[1]?.output?.komunikat === TOOL_REPEAT_MESSAGE && JSON.stringify(model.doStreamCalls[2].prompt).includes("nie powtarzam go"));
    check("Powtórzenie: kolejny krok bez narzędzi → odpowiedź z wynikiem częściowym", model.doStreamCalls[2].toolChoice?.type === "none" && textOf(message).includes("Nie udało się obliczyć") && typeof message.metadata?.sig === "string");
    check("Powtórzenie: liczniki 3 kroki, 1 wykonane wywołanie", stats?.kroki === 3 && stats?.narzedzia === 1, JSON.stringify(stats));
    check("Powtórzenie nie trafia do podsumowania (pominięte)", buildStepLimitSummary(6, [{ step: 1, name: "kalkulator", input: {}, kind: "ok", output: parts[1]?.output }], false).includes("Nie udało się jeszcze ustalić"));
  }
  {
    // To samo narzędzie z INNYMI danymi po błędzie – dozwolone.
    let runs = 0;
    const calc = { ...kalkulator, execute: async (input, o) => { runs++; return kalkulator.execute(input, o); } };
    const model = chatModel([
      [call("q1", "kalkulator", { dzialanie: "podziel", liczby: [1, 0] }), toolCallsFinish],
      [call("q2", "kalkulator", { dzialanie: "podziel", liczby: [1, 4] }), toolCallsFinish],
      [...textChunks("Wynik: 0,25."), stop],
    ]);
    await readChat(await ask(stdHandler(model, { kalkulator: calc })));
    check("Po błędzie inne dane → wykonane (2 wywołania), narzędzia nadal dostępne", runs === 2 && model.doStreamCalls[2].toolChoice?.type !== "none");
  }
  {
    // Przekroczony czas też blokuje identyczne powtórzenie.
    const wolne = slowTool("czas", 5_000);
    const model = chatModel([[call("r1", "czas", {}), toolCallsFinish], [call("r2", "czas", {}), toolCallsFinish], [...textChunks("Źródło nie odpowiada."), stop]]);
    const { stats } = await readChat(await ask(stdHandler(model, { czas: wolne }, { toolTimeoutMs: 40 })));
    check("Przekroczony czas → identyczne powtórzenie nie jest wykonywane", wolne.calls === 1 && stats?.narzedzia === 1, JSON.stringify(stats));
  }
  {
    // Wyjątek w narzędziu → błąd narzędzia; identyczne powtórzenie zablokowane.
    let runs = 0;
    const boom = tool({ description: "Narzędzie testowe zgłaszające wyjątek – tylko do testów automatycznych.", inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }), execute: async () => { runs++; throw new Error("awaria"); } });
    const model = chatModel([[call("e1", "czas", {}), toolCallsFinish], [call("e2", "czas", {}), toolCallsFinish], [...textChunks("Nie udało się sprawdzić."), stop]]);
    const e = console.error; console.error = () => {};
    const { message } = await readChat(await ask(stdHandler(model, { czas: boom })));
    console.error = e;
    check("Wyjątek narzędzia → część „output-error”, powtórzenie zablokowane", runs === 1 && message.parts.some((p) => p.type === "tool-czas" && p.state === "output-error"));
  }

  // 4. Limit czasu zadania (skrócony w teście): miękki termin → bez nowych narzędzi; twardy → wynik częściowy.
  {
    const delayStep = (ms, chunks) => async () => { await new Promise((r) => setTimeout(r, ms)); return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "m", timestamp: new Date(0) }, ...chunks]) }; };
    let n = 0;
    const steps = [delayStep(120, [call("d1", "czas", {}), toolCallsFinish]), delayStep(0, [...textChunks("Gotowe."), stop])];
    const model = new MockLanguageModelV4({ doStream: async (o) => steps[n++](o) });
    const { message } = await readChat(await ask(stdHandler(model, { czas }, { taskSoftDeadlineMs: 100, taskTimeoutMs: 5_000 })));
    check("Po miękkim terminie kolejny krok bez narzędzi (toolChoice: none)", model.doStreamCalls[0].toolChoice?.type !== "none" && model.doStreamCalls[1].toolChoice?.type === "none" && textOf(message) === "Gotowe.");
  }
  {
    // Twardy limit: drugi krok modelu „wisi” – po limicie serwer przerywa i dopisuje wynik częściowy.
    let n = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        n++;
        if (n === 1) return { stream: streamOf([{ type: "response-metadata", id: "r", modelId: "m", timestamp: new Date(0) }, call("h1", "czas", { strefa: "Europe/London" }), toolCallsFinish]) };
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: "response-metadata", id: "r2", modelId: "m", timestamp: new Date(0) });
              c.enqueue({ type: "text-start", id: "w" });
              c.enqueue({ type: "text-delta", id: "w", delta: "Sprawdzam dalej" });
              abortSignal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
            },
          }),
        };
      },
    });
    const t0 = Date.now();
    const res = await ask(stdHandler(model, { czas }, { taskTimeoutMs: 300, taskSoftDeadlineMs: 10_000 }), "Która godzina w Londynie?");
    const { message, stats, raw } = await readChat(res);
    const text = textOf(message);
    check("Twardy limit: zadanie przerwane po limicie (≈300 ms), status 200", res.status === 200 && Date.now() - t0 < 3000);
    check("Twardy limit: tekst przerwanego kroku + „Przerwałam zadanie po … (limit czasu). Udało się ustalić:”",
      text.startsWith("Sprawdzam dalej\n\n" + taskTimeoutMessage(300) + ". Udało się ustalić:") && taskTimeoutMessage(60_000) === "Przerwałam zadanie po 60 sekundach (limit czasu)", JSON.stringify(text));
    check("Twardy limit: wynik częściowy z rzeczywistego wyniku narzędzia", /– czas \(Europe\/London\):/.test(text), text);
    check("Twardy limit: odpowiedź podpisana, bez znacznika błędu", typeof message.metadata?.sig === "string" && !raw.includes('"type":"error"') && !raw.includes('"finishReason":"error"'));
    check("Twardy limit: liczniki (2 kroki, 1 wywołanie, czas ≥ 300 ms)", stats?.kroki === 2 && stats?.narzedzia === 1 && stats?.czasMs >= 300, JSON.stringify(stats));
    const next = await stdHandler(chatModel([[...textChunks("Proszę."), stop]]), { czas })(request({ mode: "chat", messages: prepareAgentMessages([user("u1", "Która godzina w Londynie?"), message, user("u2", "Dziękuję")]) }));
    check("Twardy limit: następna wiadomość z tą odpowiedzią w historii → 200 (podpis HMAC)", next.status === 200);
  }
  {
    // Zamknięcie karty przez klienta (nie limit czasu) → jak dotąd: bez podpisu.
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "response-metadata", id: "r", modelId: "m", timestamp: new Date(0) });
            c.enqueue({ type: "text-start", id: "w" });
            c.enqueue({ type: "text-delta", id: "w", delta: "Pisz" });
            abortSignal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
            setTimeout(() => controller.abort(), 50);
          },
        }),
      }),
    });
    const req = new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", cookie: COOKIE }, body: JSON.stringify({ mode: "chat", messages: [user("u1", "x")] }), signal: controller.signal });
    let raw = "";
    try { raw = await (await stdHandler(model, {}, { taskTimeoutMs: 5_000 })(req)).text(); } catch { raw = ""; }
    check("Przerwanie przez klienta → bez podpisu i bez liczników (jak dotąd)", !raw.includes('"sig"') && !raw.includes('"stats"'));
  }

  // 5. Liczniki pod odpowiedzią.
  {
    const model = chatModel([[...textChunks("Alarm od £666 + VAT."), stop]]);
    const res = await ask(stdHandler(model, { czas }));
    const raw = await res.clone().text();
    const { message, stats } = await readChat(res);
    check("Zwykła odpowiedź: liczniki 1 krok, 0 wywołań, czas w ms", stats?.kroki === 1 && stats?.narzedzia === 0 && Number.isInteger(stats?.czasMs) && stats.czasMs >= 0, JSON.stringify(stats));
    check("Liczniki w metadanych zakończenia (finish)", /"type":"finish".*"stats":\{"kroki":1,"narzedzia":0,"czasMs":\d+\}/.test(raw));
    check("formatAgentStats: „Kroki modelu: 3 · Wywołania narzędzi: 2 · Czas: 8,4 s”", formatAgentStats({ stats: { kroki: 3, narzedzia: 2, czasMs: 8400 } }) === "Kroki modelu: 3 · Wywołania narzędzi: 2 · Czas: 8,4 s");
    check("formatAgentStats: 0,3 s i 60,0 s", formatAgentStats({ stats: { kroki: 1, narzedzia: 0, czasMs: 260 } }) === "Kroki modelu: 1 · Wywołania narzędzi: 0 · Czas: 0,3 s" && formatAgentStats({ stats: { kroki: 6, narzedzia: 16, czasMs: 60000 } }) === "Kroki modelu: 6 · Wywołania narzędzi: 16 · Czas: 60,0 s");
    check("formatAgentStats: brak lub złe dane → nic", formatAgentStats({}) === null && formatAgentStats(undefined) === null && formatAgentStats({ stats: { kroki: "3", narzedzia: 1, czasMs: 1 } }) === null && formatAgentStats({ stats: { kroki: -1, narzedzia: 1, czasMs: 1 } }) === null);
    const withStats = { ...message, metadata: { ...message.metadata, stats } };
    const sent = prepareAgentMessages([user("u1", "x"), withStats, user("u2", "y")]);
    check("Przeglądarka NIE odsyła liczników (podpis zostaje)", !("stats" in sent[1].metadata) && sent[1].metadata.sig === message.metadata.sig);
    const okNext = await stdHandler(chatModel([[...textChunks("OK"), stop]]), { czas })(request({ mode: "chat", messages: sent }));
    check("Historia bez liczników → 200", okNext.status === 200);
    const w = console.warn; console.warn = () => {};
    const badNext = await stdHandler(chatModel([[...textChunks("OK"), stop]]), { czas })(request({ mode: "chat", messages: [user("u1", "x"), withStats, user("u2", "y")] }));
    console.warn = w;
    check("Historia z licznikami (niepodpisane pole) → 400", badNext.status === 400);
    const chatUi = readFileSync(new URL("../app/chat.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    check("Czat: liczniki małym tekstem pod odpowiedzią", chatUi.includes('<small className="agent-stats">{formatAgentStats(message.metadata)}</small>') && /\.agent-stats \{[^}]*font-size: 11px/.test(css));
  }

  // Instrukcja
  check("Instrukcja: przy błędzie – co nie zostało sprawdzone, bez ponawiania, wynik częściowy",
    AMBER_CHAT_INSTRUCTIONS.includes("napisz klientowi wprost, czego nie udało się sprawdzić") && AMBER_CHAT_INSTRUCTIONS.includes("Nie wywołuj ponownie tego samego narzędzia z tymi samymi danymi po błędzie") && AMBER_CHAT_INSTRUCTIONS.includes("(wynik częściowy)") && AMBER_CHAT_INSTRUCTIONS.includes("„Źródło nie odpowiada”"));
}

console.log("\n=== 17. Warsztat 2 – Fast: Stop (przerwanie przez użytkownika) ===");
{
  const logs = [];
  const fastHandler = (model, tools, extra = {}) => createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({ model, tools }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: (m) => logs.push(m),
    ...extra,
  });
  const stopRequest = (messages, signal) => new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", cookie: COOKIE }, body: JSON.stringify({ mode: "chat", messages }), signal });
  const readSafe = async (res) => { try { return await res.text(); } catch { return ""; } };

  // Stop w trakcie działania narzędzia: narzędzie dostaje sygnał przerwania, model nie robi kolejnego kroku.
  {
    let aborted = false;
    const wolne = tool({
      description: "Testowe wolne narzędzie (2 s) – tylko do testów automatycznych przycisku Stop.",
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      execute: async (_i, { abortSignal } = {}) => new Promise((resolve) => {
        const t = setTimeout(() => resolve({ ok: true }), 2_000);
        abortSignal?.addEventListener("abort", () => { clearTimeout(t); aborted = true; resolve({ ok: false, komunikat: "przerwano" }); });
      }),
    });
    const model = chatModel([[call("s1", "czas", {}), toolCallsFinish], [...textChunks("Nie powinno się pojawić."), stop]]);
    const controller = new AbortController();
    const t0 = Date.now();
    const res = await fastHandler(model, { czas: wolne })(stopRequest([user("u1", "Która godzina?")], controller.signal));
    setTimeout(() => controller.abort(), 80);
    const raw = await readSafe(res);
    await new Promise((r) => setTimeout(r, 50));
    check("Stop w trakcie narzędzia: narzędzie przerwane, bez kolejnego kroku modelu", aborted && model.doStreamCalls.length === 1 && Date.now() - t0 < 1500, `kroki: ${model.doStreamCalls.length}, przerwane: ${aborted}`);
    check("Stop: odpowiedź bez podpisu i bez liczników (nie trafia do historii)", !raw.includes('"sig"') && !raw.includes('"stats"'));
    check("Stop: wpis w logu serwera „przerwane przez użytkownika” z licznikami", logs.some((l) => /przerwane przez użytkownika \(kroki modelu: 1, wywołania narzędzi: 1, czas: \d+ ms\)/.test(l)), JSON.stringify(logs.slice(-2)));
  }
  // Stop w trakcie pisania tekstu – model przerwany.
  {
    logs.length = 0;
    const controller = new AbortController();
    let modelAborted = false;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "response-metadata", id: "r", modelId: "m", timestamp: new Date(0) });
            c.enqueue({ type: "text-start", id: "w" });
            c.enqueue({ type: "text-delta", id: "w", delta: "Częściowa odpowiedź" });
            abortSignal?.addEventListener("abort", () => { modelAborted = true; c.error(new DOMException("aborted", "AbortError")); });
          },
        }),
      }),
    });
    const res = await fastHandler(model, { czas })(stopRequest([user("u1", "Opowiedz o alarmach")], controller.signal));
    setTimeout(() => controller.abort(), 60);
    await readSafe(res);
    await new Promise((r) => setTimeout(r, 50));
    check("Stop w trakcie tekstu: model przerwany", modelAborted && logs.some((l) => l.includes("przerwane przez użytkownika (kroki modelu: 1, wywołania narzędzi: 0")), JSON.stringify(logs));
    check("Stop: nie jest traktowany jak limit 60 s (bez „Przerwałam zadanie po…”)", !logs.some((l) => l.includes("Przerwałam zadanie")));
  }
  // Po przerwaniu: kolejna wiadomość działa (częściowa odpowiedź bez podpisu nie wraca w historii).
  {
    const partial = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: "Częściowa odpowiedź" }] };
    const next = await fastHandler(chatModel([[...textChunks("Proszę zapytać ponownie."), stop]]), { czas })(request({ mode: "chat", messages: prepareAgentMessages([user("u1", "Opowiedz o alarmach"), partial, user("u2", "Jednak krócej")]) }));
    const { message, stats } = await readChat(next);
    check("Po Stop: następna wiadomość → 200, odpowiedź podpisana, liczniki działają", next.status === 200 && typeof message.metadata?.sig === "string" && stats?.kroki === 1);
    const w = console.warn; console.warn = () => {};
    const forged = await fastHandler(chatModel([[...textChunks("x"), stop]]), { czas })(request({ mode: "chat", messages: [user("u1", "Opowiedz o alarmach"), { ...partial, metadata: { kind: "chat", sig: "falszywy" } }, user("u2", "Dalej")] }));
    console.warn = w;
    check("Częściowa odpowiedź z dopisanym podpisem → 400 (HMAC bez zmian)", forged.status === 400);
  }
}

console.log("\n=== 18. Warsztat 2 – Fast: przerwane zadanie nie wraca samo (notatka w historii, zgodność HMAC) ===");
{
  const flowHandler = (model) => createAgentHandler({
    getSession: () => ({ secret: AUTH.secret, token: TOKEN }),
    createModels: () => ({ model, tools: { pogoda: createWeatherTool({ fetch: API_FETCH, now }), waluty: createCurrencyTool({ fetch: API_FETCH, now }), czas } }),
    instructions: { chat: AMBER_CHAT_INSTRUCTIONS, analyze: AMBER_ANALYZE_INSTRUCTIONS },
    history: { deriveHistoryKey, sessionIdFromToken, checkChatHistory, signAgentChatTurn },
    generateAmberOutput, maxTextChars: MAX_USER_MESSAGE_CHARS, maxRetries: 0, now: () => NOW, log: () => {},
  });
  const send = (model, messages) => flowHandler(model)(request({ mode: "chat", messages: prepareAgentMessages(messages) }));
  const userText = (prompt) => prompt.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("")));

  // Tura 1: pytanie o pogodę – przerwane Stop (częściowa odpowiedź bez podpisu, pytanie oznaczone).
  const u1 = user("u1", "Jaka jest pogoda w Londynie, Paryżu i Berlinie jutro i ile to 100 GBP w złotówkach?");
  const partial = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-czas", toolCallId: "c1", state: "output-available", input: {}, output: { ok: true } }] };
  let conv = markStoppedQuestion([u1, partial], "u1");

  // Tura 2: niezwiązane pytanie.
  const u2 = user("u2", "Ile kosztuje alarm?");
  const m2 = chatModel([[...textChunks("Czy chodzi o alarm przeciwwłamaniowy czy przeciwpożarowy?"), stop]]);
  const r2 = await send(m2, [...conv, u2]);
  const { message: a2, stats: s2 } = await readChat(r2);
  const p2 = m2.doStreamCalls[0].prompt;
  const users2 = userText(p2);
  check("Po Stop: następna wiadomość → 200, odpowiedź podpisana", r2.status === 200 && typeof a2.metadata?.sig === "string");
  check("Model dostał przerwane pytanie z notatką i nowe pytanie bez notatki",
    users2.length === 2 && users2[0].endsWith("w złotówkach?\n\n" + STOPPED_TASK_NOTE) && users2[1] === "Ile kosztuje alarm?", JSON.stringify(users2));
  check("Model dostał zasadę: nie wracaj sam do przerwanego zadania", JSON.stringify(p2.filter((m) => m.role === "system")).includes("Nie wykonuj go ponownie i nie wracaj do niego z własnej inicjatywy"));
  check("Niezwiązane pytanie: bez narzędzi (0 wywołań, 1 krok)", s2?.narzedzia === 0 && s2?.kroki === 1, JSON.stringify(s2));
  conv = [...conv, u2, a2];

  // Tura 3: wyraźna prośba o wznowienie – narzędzia dostępne, kontekst (pytanie z notatką) zachowany.
  const u3 = user("u3", "Dokończ proszę przerwane sprawdzanie pogody i kursu funta.");
  const m3 = chatModel([
    [call("w1", "pogoda", { miasto: "Londyn", data: "2026-11-13" }), call("w2", "waluty", { waluta: "GBP", kwota: 100 }), toolCallsFinish],
    [...textChunks("Londyn: deszcz. 100 GBP = 512,34 zł."), stop],
  ]);
  const r3 = await send(m3, [...conv, u3]);
  const { message: a3, stats: s3 } = await readChat(r3);
  const users3 = userText(m3.doStreamCalls[0].prompt);
  check("Wznowienie na prośbę: 200 – podpis odpowiedzi z tury 2 (obejmujący pytanie z notatką) przyjęty (HMAC)", r3.status === 200 && typeof a3.metadata?.sig === "string");
  check("Wznowienie: model widzi przerwane pytanie z notatką (kontekst) i prośbę", users3.length === 3 && users3[0].endsWith(STOPPED_TASK_NOTE) && users3[2].startsWith("Dokończ proszę"));
  check("Wznowienie: narzędzia dostępne i wykonane (pogoda, waluty)", m3.doStreamCalls[0].toolChoice?.type !== "none" && s3?.narzedzia === 2 && JSON.stringify(a3.metadata?.tools) === '["pogoda","waluty"]', JSON.stringify(a3.metadata?.tools));
  conv = [...conv, u3, a3];

  // Tura 4: dalsza rozmowa – oba podpisy nadal pasują.
  const r4 = await send(chatModel([[...textChunks("Proszę bardzo."), stop]]), [...conv, user("u4", "Dziękuję")]);
  check("Kolejna tura: 200 (podpisy obu odpowiedzi zgodne)", r4.status === 200);

  // Notatka usunięta z historii (np. ręczna zmiana) → podpis się nie zgadza → 400.
  const tampered = prepareAgentMessages([...conv, user("u4", "Dziękuję")]);
  const q = tampered.find((m) => m.id === "u1");
  q.parts = q.parts.filter((p) => !(p.type === "text" && p.text.includes(STOPPED_TASK_NOTE)));
  const w = console.warn; console.warn = () => {};
  const r5 = await flowHandler(chatModel([[...textChunks("x"), stop]]))(request({ mode: "chat", messages: tampered }));
  console.warn = w;
  check("Historia bez notatki (zmieniona) → 400 (podpis HMAC)", r5.status === 400);
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
