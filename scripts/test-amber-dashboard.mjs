// Testy lekcji 4, Warsztat 3 (Minimum, Standard, Fast): Dashboard podróży – BEZ internetu (sztuczny fetch) i BEZ modelu.
// Dashboard korzysta z TYCH SAMYCH funkcji co narzędzia agenta (geocodeCity, getWeather, getCurrency, getHolidays, getWikipedia, timeIn).
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-dashboard.mjs

import { readFileSync } from "node:fs";
import {
  COUNTRY_CURRENCY,
  DASHBOARD_MESSAGES,
  MAX_SUMMARY_CHARS,
  countSentences,
  createDashboardHandler,
  missingSources,
  summaryNamesMissing,
  differenceFromPoland,
  firstSentences,
  parseRecommendation,
  samePlace,
  sameCityMessage,
} from "../lib/amber-dashboard.ts";
import { geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia } from "../lib/amber-tools-api.ts";
import { timeIn } from "../lib/amber-tools-local.ts";
import { AMBER_CHAT_INSTRUCTIONS, AMBER_COMPARE_INSTRUCTIONS, AMBER_DASHBOARD_INSTRUCTIONS } from "../lib/amber-instructions.ts";
const neverAnswers = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
const networkDown = () => Promise.reject(new TypeError("fetch failed"));

let passed = 0;
let failed = 0;
function check(name, condition, info = "") {
  condition ? passed++ : failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${info ? `  → ${info}` : ""}`);
}

let NOW = new Date("2026-11-16T17:30:05Z");
const now = () => NOW;

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

const GEO = (name, country, cc, tz, lat = 51.5, lon = -0.12) => ({ results: [{ name, latitude: lat, longitude: lon, country, country_code: cc, timezone: tz }] });
const FORECAST = { daily: { time: ["2026-11-16", "2026-11-17", "2026-11-18"], temperature_2m_max: [9, 7.4, 8], temperature_2m_min: [3, 2.3, 4], precipitation_sum: [1, 0, 2.5], weather_code: [3, 0, 61] } };
const GBP = { table: "A", currency: "funt szterling", code: "GBP", rates: [{ effectiveDate: "2026-11-16", mid: 5.1234 }] };
const EUR = { table: "A", currency: "euro", code: "EUR", rates: [{ effectiveDate: "2026-11-16", mid: 4.4018 }] };
const GB_HOL_2026 = [
  { date: "2026-08-31", localName: "Summer Bank Holiday", name: "Summer Bank Holiday", global: false, counties: ["GB-ENG", "GB-WLS", "GB-NIR"] },
  { date: "2026-11-30", localName: "Saint Andrew's Day", name: "Saint Andrew's Day", global: false, counties: ["GB-SCT"] },
  { date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day", global: true, counties: null },
  { date: "2026-12-28", localName: "Boxing Day", name: "St. Stephen's Day", global: true, counties: null },
];
const GB_HOL_2027 = [{ date: "2027-01-01", localName: "New Year's Day", name: "New Year's Day", global: true, counties: null }];
const WIKI = (title) => ({ type: "standard", title, extract: `${title} – stolica i największe miasto. Leży nad rzeką. Trzecie zdanie, którego nie pokazujemy.`, content_urls: { desktop: { page: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title)}` } } });

function londonFetch(overrides = []) {
  return fakeFetch([
    ...overrides,
    ["geocoding-api", GEO("Londyn", "Wielka Brytania", "GB", "Europe/London")],
    ["api.open-meteo.com/v1/forecast", FORECAST],
    ["/rates/A/GBP/", GBP],
    ["/rates/A/EUR/", EUR],
    ["PublicHolidays/2026/GB", GB_HOL_2026],
    ["PublicHolidays/2027/GB", GB_HOL_2027],
    ["pl.wikipedia.org", (url) => WIKI(decodeURIComponent(url.split("/summary/")[1]).replace(/_/g, " "))],
  ]);
}

// Prawdziwe funkcje narzędzi z podanym (sztucznym) fetch – tak samo połączone jak w app/api/dashboard/route.ts.
function sourcesWith(f) {
  const o = { fetch: f, now };
  return {
    geocodeCity: (miasto) => geocodeCity(miasto, o),
    getWeather: (input, place) => getWeather(input, o, place),
    getCurrency: (input) => getCurrency(input, o),
    getHolidays: (input) => getHolidays(input, o),
    getWikipedia: (input) => getWikipedia(input, o),
    timeIn: (strefa, at) => timeIn(strefa, at),
  };
}

function handler({ f = londonFetch(), session = true, summarize = async () => "Zabierz ciepłą kurtkę. Sprawdź kurs funta przed wyjazdem.", counter = {} } = {}) {
  counter.summaries = 0;
  counter.inputs = [];
  const h = createDashboardHandler({
    hasSession: () => session,
    sources: sourcesWith(f),
    summarize: summarize ? async (input) => { counter.summaries++; counter.inputs.push(input); return summarize(input); } : null,
    now,
    log: () => {},
  });
  return { handle: h, f, counter };
}
const request = (body) => new Request("http://localhost/api/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const silent = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ---------------------------------------------------------------------------
console.log("\n=== 1. Sesja: bez sesji 401, zanim cokolwiek zostanie pobrane ===");
{
  const { handle, f, counter } = handler({ session: false });
  const r = await handle(request({ miasto: "Londyn", data: "2026-11-17" }));
  const body = await r.json();
  check("Bez sesji → 401 z komunikatem po polsku", r.status === 401 && body.error === DASHBOARD_MESSAGES.unauthorized);
  check("Bez sesji: brak zapytań do źródeł i brak modelu", f.calls.length === 0 && counter.summaries === 0);
  const r2 = await handler({ session: false }).handle(request("to nie JSON"));
  check("Bez sesji 401 nawet przy złej treści (sesja jest pierwsza)", r2.status === 401);
}

console.log("\n=== 2. Dane wejściowe → 400 z komunikatem po polsku ===");
for (const [name, body, msg] of [
  ["zły JSON", "{", DASHBOARD_MESSAGES.badRequest],
  ["tablica zamiast obiektu", [], DASHBOARD_MESSAGES.badRequest],
  ["dodatkowe pole", { miasto: "Londyn", data: "2026-11-17", tryb: "porownaj" }, DASHBOARD_MESSAGES.badRequest],
  ["brak miasta", { data: "2026-11-17" }, DASHBOARD_MESSAGES.noCity],
  ["puste miasto", { miasto: "   ", data: "2026-11-17" }, DASHBOARD_MESSAGES.noCity],
  ["miasto > 100 znaków", { miasto: "a".repeat(101), data: "2026-11-17" }, DASHBOARD_MESSAGES.noCity],
  ["brak daty", { miasto: "Londyn" }, DASHBOARD_MESSAGES.badDate],
  ["zła data", { miasto: "Londyn", data: "17.11.2026" }, DASHBOARD_MESSAGES.badDate],
  ["nieistniejąca data", { miasto: "Londyn", data: "2026-02-30" }, DASHBOARD_MESSAGES.badDate],
]) {
  const { handle, f } = handler();
  const r = await handle(request(body));
  const b = await r.json();
  check(`${name} → 400`, r.status === 400 && b.error === msg && f.calls.length === 0, `${r.status} ${b.error}`);
}
{
  const { handle, counter } = handler({ f: fakeFetch([["geocoding-api", { results: [] }]]) });
  const r = await handle(request({ miasto: "Xyzabc", data: "2026-11-17" }));
  const b = await r.json();
  check("Nieznane miasto → 400 „Nie znalazłam miasta…” (komunikat narzędzia)", r.status === 400 && b.error.startsWith("Nie znalazłam miasta „Xyzabc”") && counter.summaries === 0, b.error);
}

console.log("\n=== 3. Poprawne zapytanie: 5 kart z istniejących funkcji ===");
{
  const { handle, f, counter } = handler();
  const r = await handle(request({ miasto: "Londyn", data: "2026-11-17" }));
  const b = await r.json();
  check("Status 200, miasto i kraj z geokodowania", r.status === 200 && b.miasto === "Londyn" && b.kraj === "Wielka Brytania" && b.data === "2026-11-17");
  check("5 kart w stałej kolejności", JSON.stringify(b.karty.map((k) => k.id)) === '["pogoda","waluty","swieta","wikipedia","czas"]');
  check("Każda karta: wartość, źródło i godzina pobrania", b.karty.every((k) => k.ok && k.wartosc && k.zrodlo && /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/.test(k.pobrano)), JSON.stringify(b.karty.map((k) => [k.id, k.pobrano])));
  const geoCalls = f.calls.filter((c) => c.url.includes("geocoding-api"));
  check("Geokodowanie dokładnie raz (karta Pogoda używa wyniku geocodeCity)", geoCalls.length === 1, String(geoCalls.length));
  const [pogoda, waluty, swieta, wikipedia, czas] = b.karty;
  check("Pogoda: zakres temperatur z jednostką °C", pogoda.wartosc === "2,3–7,4" && pogoda.jednostka === "°C" && pogoda.szczegoly === "17.11.2026: bezchmurnie, opady 0 mm" && pogoda.zrodlo === "Open-Meteo", JSON.stringify(pogoda));
  const fc = new URL(f.calls.find((c) => c.url.includes("/v1/forecast")).url);
  check("Pogoda: współrzędne z geokodowania, forecast_days=16", fc.searchParams.get("latitude") === "51.5" && fc.searchParams.get("forecast_days") === "16");
  check("Waluty: 1 GBP = 5,1234 zł, kurs NBP z datą", waluty.wartosc === "1 GBP = 5,1234" && waluty.jednostka === "zł" && waluty.szczegoly === "kurs średni NBP z 16.11.2026" && waluty.zrodlo === "NBP", JSON.stringify(waluty));
  check("Święta: 3 najbliższe od daty podróży, zakres tylko z API", swieta.wartosc === "30.11.2026 – Saint Andrew's Day" && swieta.szczegoly === "30.11.2026 – Saint Andrew's Day (Szkocja)\n25.12.2026 – Christmas Day (cały kraj)\n28.12.2026 – Boxing Day (cały kraj)" && swieta.zrodlo === "Nager.Date", JSON.stringify(swieta.szczegoly));
  check("Wikipedia: 2 zdania i link", wikipedia.wartosc === "Londyn" && wikipedia.szczegoly === "Londyn – stolica i największe miasto. Leży nad rzeką." && wikipedia.link === "https://pl.wikipedia.org/wiki/Londyn" && wikipedia.zrodlo === "Wikipedia (pl)");
  check("Czas: godzina na miejscu i różnica względem Polski (−1 h)", czas.wartosc === "17:30" && czas.szczegoly === "poniedziałek, 16.11.2026; różnica względem Polski: −1 h" && czas.zrodlo === "zegar serwera, strefa Europe/London", JSON.stringify(czas));
  check("Podsumowanie agenta pod kartami", b.podsumowanie === "Zabierz ciepłą kurtkę. Sprawdź kurs funta przed wyjazdem.");
  check("Model dostał wyłącznie dane z 5 kart (bez linków)", counter.inputs.length === 1 && counter.inputs[0].karty.length === 5 && !JSON.stringify(counter.inputs[0]).includes("http") && counter.inputs[0].karty[0].wartosc === "2,3–7,4 °C");
}

console.log("\n=== 4. Istniejące funkcje dostają poprawne dane ===");
{
  const { handle, f } = handler();
  await handle(request({ miasto: "  Londyn ", data: "2026-11-17" }));
  const urls = f.calls.map((c) => c.url);
  check("geocodeCity: miasto bez spacji na brzegach", new URL(urls[0]).searchParams.get("name") === "Londyn");
  check("getCurrency: waluta kraju (GBP), tabela A", urls.some((u) => u === "https://api.nbp.pl/api/exchangerates/rates/A/GBP/?format=json"));
  check("getHolidays: kraj GB, rok 2026", urls.some((u) => u.endsWith("/PublicHolidays/2026/GB")));
  check("getWikipedia: hasło = nazwa miasta", urls.some((u) => u.endsWith("/page/summary/Londyn")));
}

console.log("\n=== 5. Waluta kraju docelowego ===");
{
  const pl = fakeFetch([["geocoding-api", GEO("Warszawa", "Polska", "PL", "Europe/Warsaw", 52.2, 21)], ["forecast", FORECAST], ["PublicHolidays", []], ["wikipedia", WIKI("Warszawa")]]);
  const b = await (await handler({ f: pl }).handle(request({ miasto: "Warszawa", data: "2026-11-17" }))).json();
  check("PL → „złoty (PLN)”, waluta lokalna, bez zapytania do NBP", b.karty[1].ok && b.karty[1].wartosc === "złoty (PLN)" && !pl.calls.some((c) => c.url.includes("nbp")));
  check("PL → różnica czasu 0 h", b.karty[4].szczegoly.endsWith("różnica względem Polski: 0 h"));
  const de = fakeFetch([["geocoding-api", GEO("Berlin", "Niemcy", "DE", "Europe/Berlin")], ["forecast", FORECAST], ["/rates/A/EUR/", EUR], ["PublicHolidays", []], ["wikipedia", WIKI("Berlin")]]);
  const b2 = await (await handler({ f: de }).handle(request({ miasto: "Berlin", data: "2026-11-17" }))).json();
  check("DE → EUR (1 EUR = 4,4018 zł)", b2.karty[1].wartosc === "1 EUR = 4,4018");
  const xx = fakeFetch([["geocoding-api", GEO("Ulan Bator", "Mongolia", "MN", "Asia/Ulaanbaatar")], ["forecast", FORECAST], ["PublicHolidays", []], ["wikipedia", WIKI("Ułan Bator")]]);
  const b3 = await (await handler({ f: xx }).handle(request({ miasto: "Ulan Bator", data: "2026-11-17" }))).json();
  check("Kraj spoza tabeli → komunikat, bez zgadywania waluty", !b3.karty[1].ok && b3.karty[1].komunikat === "Nie mam przypisanej waluty dla kraju Mongolia." && !xx.calls.some((c) => c.url.includes("nbp")));
  check("Tabela walut: strefa euro, GB, US", COUNTRY_CURRENCY.FR === "EUR" && COUNTRY_CURRENCY.GB === "GBP" && COUNTRY_CURRENCY.US === "USD" && !("PL" in COUNTRY_CURRENCY));
}

console.log("\n=== 6. Święta: najbliższe od daty podróży, przejście na następny rok ===");
{
  const { handle } = handler();
  const b = await (await handle(request({ miasto: "Londyn", data: "2026-12-26" }))).json();
  check("26.12 → 28.12.2026 i 01.01.2027 (następny rok)", b.karty[2].szczegoly === "28.12.2026 – Boxing Day (cały kraj)\n01.01.2027 – New Year's Day (cały kraj)", JSON.stringify(b.karty[2].szczegoly));
  const none = fakeFetch([["geocoding-api", GEO("Londyn", "Wielka Brytania", "GB", "Europe/London")], ["forecast", FORECAST], ["/rates/A/GBP/", GBP], ["PublicHolidays/2026/GB", [GB_HOL_2026[0]]], ["PublicHolidays/2027/GB", status(503)], ["wikipedia", WIKI("Londyn")]]);
  const b2 = await (await handler({ f: none }).handle(request({ miasto: "Londyn", data: "2026-12-01" }))).json();
  check("Brak świąt po dacie → „brak” (bez zmyślania)", b2.karty[2].ok && b2.karty[2].wartosc === "brak");
  const noScope = fakeFetch([["geocoding-api", GEO("Londyn", "Wielka Brytania", "GB", "Europe/London")], ["forecast", FORECAST], ["/rates/A/GBP/", GBP], ["PublicHolidays/2026/GB", [{ date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day" }]], ["PublicHolidays/2027/GB", []], ["wikipedia", WIKI("Londyn")]]);
  const b3 = await (await handler({ f: noScope }).handle(request({ miasto: "Londyn", data: "2026-12-01" }))).json();
  check("Brak pól global/counties → bez dopisanego zakresu", b3.karty[2].szczegoly === "25.12.2026 – Christmas Day");
}

console.log("\n=== 7. Różnica czasu względem Polski ===");
{
  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");
  check("Londyn zimą −1 h", differenceFromPoland("Europe/London", winter) === "−1 h");
  check("Londyn latem −1 h", differenceFromPoland("Europe/London", summer) === "−1 h");
  check("Tokio zimą +8 h, latem +7 h (czas letni w Polsce)", differenceFromPoland("Asia/Tokyo", winter) === "+8 h" && differenceFromPoland("Asia/Tokyo", summer) === "+7 h");
  check("Warszawa 0 h", differenceFromPoland("Europe/Warsaw", winter) === "0 h");
  check("Nowy Jork zimą −6 h", differenceFromPoland("America/New_York", winter) === "−6 h");
  check("Indie zimą +4,5 h (pół godziny)", differenceFromPoland("Asia/Kolkata", winter) === "+4,5 h");
  check("Okres przejściowy 20.03.2026 (Nowy Jork już w czasie letnim, Polska jeszcze nie) → −5 h", differenceFromPoland("America/New_York", new Date("2026-03-20T12:00:00Z")) === "−5 h");
}

console.log("\n=== 8. Wikipedia: dwa zdania ===");
check("firstSentences: 2 z 3 zdań", firstSentences("A b. C d? E f!") === "A b. C d?");
check("firstSentences: jedno zdanie bez zmian", firstSentences("Tylko jedno") === "Tylko jedno");

console.log("\n=== 9. Komunikaty narzędzi na kartach (bez dodatkowej logiki) ===");
{
  const down = londonFetch([["/rates/A/GBP/", status(503)], ["api.open-meteo.com/v1/forecast", status(500)]]);
  const r = await handler({ f: down }).handle(request({ miasto: "Londyn", data: "2026-11-17" }));
  const b = await r.json();
  check("Status 200 – pozostałe karty z danymi", r.status === 200 && b.karty[2].ok && b.karty[3].ok && b.karty[4].ok);
  check("Pogoda: komunikat narzędzia bez zmian", !b.karty[0].ok && b.karty[0].komunikat === "Serwis pogodowy Open-Meteo nie odpowiada. Spróbuj ponownie za chwilę." && b.karty[0].zrodlo === "Open-Meteo" && b.karty[0].pobrano);
  check("Waluty: komunikat narzędzia bez zmian", !b.karty[1].ok && b.karty[1].komunikat === "Serwis NBP nie odpowiada. Spróbuj ponownie za chwilę.");
}

console.log("\n=== 10. Podsumowanie agenta ===");
{
  for (const [name, summarize] of [
    ["błąd modelu", async () => { throw new Error("provider down"); }],
    ["pusta odpowiedź", async () => "   "],
    [`odpowiedź > ${MAX_SUMMARY_CHARS} znaków`, async () => "a".repeat(MAX_SUMMARY_CHARS + 1)],
  ]) {
    const r = await silent(() => handler({ summarize }).handle(request({ miasto: "Londyn", data: "2026-11-17" })));
    const b = await r.json();
    check(`${name} → „Podsumowanie niedostępne” (podsumowanie: null), karty zostają`, r.status === 200 && b.podsumowanie === null && b.karty.length === 5 && b.karty.every((k) => k.ok));
  }
  // 2–3 zdania (wymaganie lekcji).
  for (const [n, text, ok] of [
    [1, "Zabierz parasol.", false],
    [2, "Zabierz parasol. Sprawdź kurs funta.", true],
    [3, "Zabierz parasol na 15,8 mm deszczu. Różnica czasu to −1 h. Kurs: 1 GBP = 5,2768 zł z 16.11.2026.", true],
    [4, "Zabierz parasol. Weź kurtkę. Sprawdź kurs funta. Pamiętaj o świętach.", false],
  ]) {
    const r = await handler({ summarize: async () => text }).handle(request({ miasto: "Londyn", data: "2026-11-17" }));
    const b = await r.json();
    check(`Podsumowanie z ${n} zdani${n === 1 ? "em" : "ami"} → ${ok ? "pokazane" : "„Podsumowanie niedostępne”, karty zostają"}`, r.status === 200 && (ok ? b.podsumowanie === text : b.podsumowanie === null) && b.karty.length === 5, `zdań: ${countSentences(text)}`);
  }
  check("Liczenie zdań: liczby i daty nie dzielą zdania", countSentences("Od 5,2 do 12,5 °C dnia 17.11.2026 r. jest chłodno. Kurs 5.2768 zł.") === 3 && countSentences("Od 5,2 do 12,5 °C dnia 17.11.2026 jest chłodno. Kurs 5.2768 zł.") === 2);
  check("Liczenie zdań: wykrzyknik, pytajnik, wielokropek", countSentences("Uwaga! Pada? Tak… Koniec.") === 4);
  const b = await (await handler({ summarize: null }).handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  check("Brak konfiguracji modelu → podsumowanie: null, karty zostają", b.podsumowanie === null && b.karty.length === 5);
  check("Instrukcja: 2–3 zdania, co spakować i na co uważać", AMBER_DASHBOARD_INSTRUCTIONS.includes("Napisz 2–3 zdania po polsku: co warto spakować i na co uważać."));
  check("Instrukcja: tylko dane z kart, bez zgadywania", AMBER_DASHBOARD_INSTRUCTIONS.includes("Opieraj się wyłącznie na danych z kart") && AMBER_DASHBOARD_INSTRUCTIONS.includes("niczego nie zgaduj"));
  check("Instrukcja: forma „Państwo”, bez „Ty/Twój/Pan/Pani”", AMBER_DASHBOARD_INSTRUCTIONS.includes("Zwracaj się w formie „Państwo”") && AMBER_DASHBOARD_INSTRUCTIONS.includes("nie używaj form „Ty”, „Twój”, „Pan”, „Pani”"));
  check("Instrukcje czatu bez sekcji Dashboardu", !AMBER_CHAT_INSTRUCTIONS.includes("Dashboardzie"));
}

console.log("\n=== 11. Odśwież: nowe godziny pobrania ===");
{
  const { handle, f } = handler();
  NOW = new Date("2026-11-16T17:30:05Z");
  const a = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  NOW = new Date("2026-11-16T17:35:42Z");
  const b = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  check("Pierwsze pobranie 17:30:05, odświeżenie 17:35:42", a.karty.every((k) => k.pobrano === "16.11.2026, 17:30:05") && b.karty.every((k) => k.pobrano === "16.11.2026, 17:35:42"), JSON.stringify(b.karty.map((k) => k.pobrano)));
  check("Odświeżenie pobiera dane ponownie (2 × geokodowanie, 2 × prognoza)", f.calls.filter((c) => c.url.includes("geocoding")).length === 2 && f.calls.filter((c) => c.url.includes("/v1/forecast")).length === 2);
  check("Odświeżona karta Czas pokazuje nową godzinę", b.karty[4].wartosc === "17:35");
  NOW = new Date("2026-11-16T17:30:05Z");
}

console.log("\n=== 12. Narzędzie pogoda bez zmian (geocodeCity wydzielone) ===");
{
  const f = londonFetch();
  const r = await getWeather({ miasto: "Londyn", data: "2026-11-17" }, { fetch: f, now });
  check("getWeather bez gotowego miejsca: sam geokoduje (1 raz) i zwraca te same pola", r.ok && r.miasto === "Londyn" && r.kraj === "Wielka Brytania" && f.calls.filter((c) => c.url.includes("geocoding")).length === 1 && Object.keys(r).sort().join() === "data,kraj,miasto,ok,opadyMm,opis,pobrano,temperaturaMaxC,temperaturaMinC,zrodlo");
  const g = await geocodeCity("Londyn", { fetch: londonFetch(), now });
  check("geocodeCity: nazwa, kraj, kod kraju, strefa", g.ok && g.place.countryCode === "GB" && g.place.timezone === "Europe/London" && g.place.country === "Wielka Brytania");
  const miss = await getWeather({ miasto: "Xyzabc" }, { fetch: fakeFetch([["geocoding-api", { results: [] }]]), now });
  check("getWeather: brak miasta – ten sam komunikat co wcześniej", !miss.ok && miss.komunikat === "Nie znalazłam miasta „Xyzabc”. Sprawdź pisownię albo podaj większe miasto w pobliżu.");
}

console.log("\n=== 13. Pliki: strona, endpoint, linki ===");
{
  const route = readFileSync(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../app/dashboard/dashboard.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../app/chat.tsx", import.meta.url), "utf8");
  check("Endpoint: zalogowana osoba przez getCurrentUser, te same funkcje narzędzi", route.includes("(await getCurrentUser()) !== null") && /geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia/.test(route) && route.includes("timeIn"));
  check("Endpoint: podsumowanie bez narzędzi (brak tools w generateText)", !/tools\s*:/.test(route));
  check("Strona: zalogowana osoba sprawdzana na serwerze, bez logowania /login", page.includes("await getCurrentUser()") && page.includes('if (!user) redirect("/login")'));
  check("Link powrotny do czatu", page.includes('href="/"') && page.includes("Wróć do czatu"));
  check("Link do Dashboardu w nagłówku czatu", chat.includes('href="/dashboard"') && chat.includes("Dashboard podróży"));
  check("Formularz: „Dokąd jedziesz?”, „Kiedy?”, „Sprawdź”, „Odśwież”", ["Dokąd jedziesz?", "Kiedy?", '"Sprawdź"', '"Odśwież"'].every((t) => ui.includes(t)));
  check("„Podsumowanie niedostępne” przy braku podsumowania", ui.includes('.podsumowanie ?? "Podsumowanie niedostępne"'));
  check("Fast: tryb porównania przez ten sam endpoint (pole miasto2), bez narzędzi", route.includes("AMBER_COMPARE_INSTRUCTIONS") && ui.includes("miasto2") && ui.includes('"Porównaj"'));
}

console.log("\n=== 14. STANDARD: stany kart i awaria jednego źródła ===");
{
  const { handle } = handler();
  const b = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  check("Wszystkie źródła działają → 5 × stan „ok”", b.karty.every((k) => k.stan === "ok" && k.ok));
}
const SOURCE_OUTAGES = [
  ["pogoda", "Open-Meteo (prognoza)", "api.open-meteo.com/v1/forecast"],
  ["waluty", "NBP", "api.nbp.pl"],
  ["swieta", "Nager.Date", "date.nager.at"],
  ["wikipedia", "Wikipedia", "pl.wikipedia.org"],
];
for (const [id, name, host] of SOURCE_OUTAGES) {
  for (const [kind, reply] of [["HTTP 503", status(503)], ["brak sieci", networkDown], ["timeout", neverAnswers]]) {
    const f = londonFetch([[host, reply]]);
    const o = { fetch: f, now, timeoutMs: 30 };
    const h = createDashboardHandler({
      hasSession: () => true,
      sources: {
        geocodeCity: (m) => geocodeCity(m, o), getWeather: (i, p) => getWeather(i, o, p), getCurrency: (i) => getCurrency(i, o),
        getHolidays: (i) => getHolidays(i, o), getWikipedia: (i) => getWikipedia(i, o), timeIn: (z, at) => timeIn(z, at),
      },
      summarize: null, now, log: () => {},
    });
    const r = await h(request({ miasto: "Londyn", data: "2026-11-17" }));
    const b = await r.json();
    const bad = b.karty.find((k) => k.id === id);
    const others = b.karty.filter((k) => k.id !== id);
    check(`${name} – ${kind}: ta karta „brak_danych”, pozostałe 4 „ok”, status 200`, r.status === 200 && bad.stan === "brak_danych" && !bad.wartosc && others.length === 4 && others.every((k) => k.stan === "ok" && k.wartosc), `${bad.stan} | ${others.map((k) => k.stan).join(",")}`);
    if (kind === "HTTP 503") check(`${name}: przyczyna z narzędzia, bez danych zastępczych`, /nie odpowiada/.test(bad.komunikat) && bad.szczegoly === undefined && bad.link === undefined);
  }
}
{
  // Wyjątek w funkcji jednej karty (np. nieoczekiwany błąd) → tylko ta karta bez danych.
  const src = sourcesWith(londonFetch());
  const e = console.error; console.error = () => {};
  const h = createDashboardHandler({ hasSession: () => true, sources: { ...src, getHolidays: async () => { throw new Error("boom"); } }, summarize: null, now, log: () => {} });
  const r = await h(request({ miasto: "Londyn", data: "2026-11-17" }));
  console.error = e;
  const b = await r.json();
  check("Wyjątek w karcie Święta → tylko ona „brak_danych”, status 200", r.status === 200 && b.karty[2].stan === "brak_danych" && b.karty[2].komunikat === "Źródło nie zwróciło danych." && b.karty.filter((k) => k.stan === "ok").length === 4);
  const h2 = createDashboardHandler({ hasSession: () => true, sources: { ...src, timeIn: () => { throw new RangeError("Invalid time zone"); } }, summarize: null, now, log: () => {} });
  console.error = () => {};
  const b2 = await (await h2(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  console.error = e;
  check("Wyjątek w karcie Czas → tylko ona „brak_danych”", b2.karty[4].stan === "brak_danych" && b2.karty.filter((k) => k.stan === "ok").length === 4);
}
{
  // Całe Open-Meteo (także geokodowanie) nie odpowiada → Wikipedia działa, pozostałe bez danych, status 200.
  const f = londonFetch([["open-meteo.com", status(503)]]);
  const { handle } = handler({ f, summarize: null });
  const r = await handle(request({ miasto: "Londyn", data: "2026-11-17" }));
  const b = await r.json();
  check("Geokodowanie niedostępne → status 200 (nie błąd całej strony)", r.status === 200 && b.miasto === "Londyn");
  check("Geokodowanie niedostępne → Wikipedia „ok”, 4 karty „brak_danych”", b.karty[3].stan === "ok" && b.karty[3].wartosc === "Londyn" && [0, 1, 2, 4].every((i) => b.karty[i].stan === "brak_danych" && /Open-Meteo nie odpowiada/.test(b.karty[i].komunikat)));
  check("Geokodowanie niedostępne → bez zapytań do NBP i Nager (bez zgadywania kraju)", !f.calls.some((c) => c.url.includes("nbp") || c.url.includes("nager")));
  const missing = await handler({ f: fakeFetch([["geocoding-api", { results: [] }]]) }).handle(request({ miasto: "Xyzabc", data: "2026-11-17" }));
  check("Nieznane miasto nadal → 400 „Nie znalazłam miasta…”", missing.status === 400);
}
{
  // Bez danych zastępczych przy odświeżaniu: najpierw dane, potem awaria → brak danych (nie stare wartości).
  let down = false;
  const f = londonFetch([["api.nbp.pl", () => (down ? status(503) : GBP)]]);
  const { handle } = handler({ f, summarize: null });
  const a = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  down = true;
  const b = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
  check("Odświeżenie z awarią NBP → „brak_danych”, bez poprzedniego kursu", a.karty[1].stan === "ok" && a.karty[1].wartosc === "1 GBP = 5,1234" && b.karty[1].stan === "brak_danych" && b.karty[1].wartosc === "" && !JSON.stringify(b.karty[1]).includes("5,1234"));
}
{
  // Podsumowanie musi wprost wskazać brakujące źródło.
  const f = () => londonFetch([["api.nbp.pl", status(503)]]);
  const run = async (text) => {
    const c = {};
    const { handle } = handler({ f: f(), summarize: async () => text, counter: c });
    const b = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
    return { b, c };
  };
  const okText = "Warto spakować kurtkę przeciwdeszczową. Brak danych z NBP o kursie waluty, więc kurs warto sprawdzić przed wyjazdem.";
  const { b: b1, c: c1 } = await run(okText);
  check("Podsumowanie wymienia brakujące źródło (NBP) → pokazane", b1.podsumowanie === okText);
  check("Model dostaje listę brakujących źródeł: [„Waluty (NBP)”]", JSON.stringify(c1.inputs[0].brakujaceZrodla) === '["Waluty (NBP)"]');
  check("Model dostaje kartę ze stanem „brak danych”, bez wartości", JSON.stringify(c1.inputs[0].karty[1]) .includes('"stan":"brak danych"') && !("wartosc" in c1.inputs[0].karty[1]));
  const { b: b2 } = await run("Warto spakować kurtkę przeciwdeszczową. Różnica czasu wynosi minus jedną godzinę.");
  check("Podsumowanie pomija brakujące źródło → „Podsumowanie niedostępne” (null), karty zostają", b2.podsumowanie === null && b2.karty.length === 5 && b2.karty.filter((k) => k.stan === "ok").length === 4);
  const { b: b3 } = await run("Warto spakować kurtkę przeciwdeszczową. Brak danych o walucie – proszę ją sprawdzić przed podróżą.");
  check("Wymienienie po nazwie karty („walucie”) też przyjęte", typeof b3.podsumowanie === "string");
  const { c: c4 } = await (async () => { const c = {}; const { handle } = handler({ counter: c }); await handle(request({ miasto: "Londyn", data: "2026-11-17" })); return { c }; })();
  check("Wszystkie źródła działają → lista brakujących pusta", JSON.stringify(c4.inputs[0].brakujaceZrodla) === "[]");
  check("missingSources / summaryNamesMissing", JSON.stringify(missingSources([{ id: "pogoda", stan: "brak_danych" }, { id: "czas", stan: "ok" }])) === '["Pogoda (Open-Meteo)"]' && summaryNamesMissing("Brak prognozy pogody.", [{ id: "pogoda", stan: "brak_danych" }]) && !summaryNamesMissing("Weź parasol.", [{ id: "pogoda", stan: "brak_danych" }]));
  check("Odmiana słów: „walucie”, „świąt”, „pogodzie”", summaryNamesMissing("Brak danych o walucie.", [{ id: "waluty", stan: "brak_danych" }]) && summaryNamesMissing("Brak listy świąt.", [{ id: "swieta", stan: "brak_danych" }]) && summaryNamesMissing("Brak informacji o pogodzie.", [{ id: "pogoda", stan: "brak_danych" }]));
  check("Instrukcja: wprost wskazać brakujące źródło, bez wartości zastępczych", AMBER_DASHBOARD_INSTRUCTIONS.includes("napisz wprost, którego źródła zabrakło") && AMBER_DASHBOARD_INSTRUCTIONS.includes("nie wstawiaj wartości zastępczych"));
}
{
  // Strona: stany „OK”, „Ładuję…”, „Brak danych” i komunikat „Brak danych — spróbuj odświeżyć”.
  const ui = readFileSync(new URL("../app/dashboard/dashboard.tsx", import.meta.url), "utf8");
  check("UI: etykiety stanów OK / Ładuję… / Brak danych", ui.includes(">OK<") && ui.includes("Ładuję…") && ui.includes(">Brak danych<"));
  check("UI: „Brak danych — spróbuj odświeżyć” i przyczyna mniejszym drukiem", ui.includes('"Brak danych — spróbuj odświeżyć"') && ui.includes('className="card-reason"'));
  check("UI: przy błędzie zapytania poprzednie karty nie zostają (setResult(null))", (ui.match(/setResult\(null\)/g) ?? []).length >= 2);
  check("UI Fast: przełącznik „Jedno miasto / Porównaj”, karty obok siebie, „Rekomendacja niedostępna”", ui.includes("Jedno miasto") && ui.includes('className="compare-columns"') && ui.includes("Rekomendacja niedostępna") && ui.includes("Wspólna data"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 15. Fast: tryb „Porównaj” (dwa miasta, wspólna data, rekomendacja) ===");
{
  const FR_HOL_2026 = [{ date: "2026-12-25", localName: "Noël", name: "Christmas Day", global: true, counties: null }];
  // Geokodowanie zależne od wpisanej nazwy (parametr name). „London” → „Londyn” (jak Open-Meteo z językiem pl).
  const GEO_BY_NAME = {
    londyn: GEO("Londyn", "Wielka Brytania", "GB", "Europe/London"),
    london: GEO("Londyn", "Wielka Brytania", "GB", "Europe/London"),
    "paryż": GEO("Paryż", "Francja", "FR", "Europe/Paris", 48.85, 2.35),
    paris: GEO("Paryż", "Francja", "FR", "Europe/Paris", 48.85, 2.35),
    xyzabc: { results: [] },
    qwerty: { results: [] },
  };
  const geoName = (url) => (new URL(url).searchParams.get("name") ?? "").toLocaleLowerCase("pl-PL");
  function twoCityFetch(geoOverride) {
    return fakeFetch([
      ["geocoding-api", (url, init) => (geoOverride ? geoOverride(geoName(url), url, init) : null) ?? GEO_BY_NAME[geoName(url)] ?? { results: [] }],
      ["api.open-meteo.com/v1/forecast", FORECAST],
      ["/rates/A/GBP/", GBP],
      ["/rates/A/EUR/", EUR],
      ["PublicHolidays/2026/GB", GB_HOL_2026],
      ["PublicHolidays/2027/GB", GB_HOL_2027],
      ["PublicHolidays/2026/FR", FR_HOL_2026],
      ["PublicHolidays/2027/FR", []],
      ["pl.wikipedia.org", (url) => WIKI(decodeURIComponent(url.split("/summary/")[1]).replace(/_/g, " "))],
    ]);
  }
  const GOOD = "MIASTO: Paryż\nW Paryżu prognoza jest podobna, a święta wypadają później. Warto, aby Państwo sprawdzili kurs euro przed wyjazdem.";
  function compareHandler({ f = twoCityFetch(), session = true, recommend = async () => GOOD } = {}) {
    const c = { recommends: 0, summaries: 0, inputs: [] };
    const h = createDashboardHandler({
      hasSession: () => session,
      sources: sourcesWith(f),
      summarize: async () => { c.summaries++; return "x"; },
      recommend: recommend ? async (input) => { c.recommends++; c.inputs.push(input); return recommend(input); } : null,
      now,
      log: () => {},
    });
    return { handle: h, f, c };
  }
  const geoCalls = (f) => f.calls.filter((x) => x.url.includes("geocoding-api")).length;

  // Sesja pierwsza
  {
    const { handle, f, c } = compareHandler({ session: false });
    const r = await handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" }));
    check("Porównanie bez sesji → 401, bez źródeł i bez modelu", r.status === 401 && f.calls.length === 0 && c.recommends === 0);
  }

  // Walidacja drugiego miasta
  for (const [name, m2] of [["puste", ""], ["same spacje", "   "], ["nie tekst", 5], ["null", null], ["za długie", "a".repeat(101)]]) {
    const { handle, f } = compareHandler();
    const r = await handle(request({ miasto: "Londyn", miasto2: m2, data: "2026-11-17" }));
    const b = await r.json();
    check(`miasto2 ${name} → 400 „Wpisz drugie miasto…”`, r.status === 400 && b.error === DASHBOARD_MESSAGES.noCity2 && f.calls.length === 0, `${r.status} ${b.error}`);
  }
  {
    const { handle, f } = compareHandler();
    const r = await handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "17.11.2026" }));
    check("Porównanie: zła data → 400, bez zapytań", r.status === 400 && f.calls.length === 0);
    const r2 = await handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17", miasto3: "Rzym" }));
    check("Porównanie: nieznane pole → 400", r2.status === 400);
  }

  // Poprawne porównanie
  {
    const { handle, f, c } = compareHandler({ recommend: async () => "miasto: paryż\nW Paryżu prognoza jest podobna, a święta wypadają później. Warto, aby Państwo sprawdzili kurs euro przed wyjazdem." });
    const r = await handle(request({ miasto: " Londyn ", miasto2: "Paryż", data: "2026-11-17" }));
    const b = await r.json();
    check("Status 200, tryb „porownanie”, wspólna data", r.status === 200 && b.tryb === "porownanie" && b.data === "2026-11-17");
    check("Dwa miasta w kolejności formularza, nazwy i kraje z geokodowania", b.miasta.length === 2 && b.miasta[0].miasto === "Londyn" && b.miasta[0].kraj === "Wielka Brytania" && b.miasta[1].miasto === "Paryż" && b.miasta[1].kraj === "Francja");
    check("Po 5 kart na miasto, w stałej kolejności", b.miasta.every((m) => JSON.stringify(m.karty.map((k) => k.id)) === '["pogoda","waluty","swieta","wikipedia","czas"]'));
    check("Wszystkie karty OK", b.miasta.every((m) => m.karty.every((k) => k.stan === "ok")));
    check("Waluty: GBP dla Londynu, EUR dla Paryża", b.miasta[0].karty[1].wartosc === "1 GBP = 5,1234" && b.miasta[1].karty[1].wartosc === "1 EUR = 4,4018");
    check("Czas: różnica względem Polski −1 h i 0 h", b.miasta[0].karty[4].szczegoly.endsWith("−1 h") && b.miasta[1].karty[4].szczegoly.endsWith("0 h"));
    check("Geokodowanie dokładnie raz na miasto (2 razy)", geoCalls(f) === 2, String(geoCalls(f)));
    check("Rekomendacja: „miasto: paryż” (małe litery) → nazwa z geokodowania „Paryż”", b.rekomendacja?.miasto === "Paryż" && b.rekomendacja.uzasadnienie.startsWith("W Paryżu"), JSON.stringify(b.rekomendacja));
    check("Model: jedno wywołanie rekomendacji, bez podsumowania jednego miasta", c.recommends === 1 && c.summaries === 0);
    check("Model dostał tylko dane kart obu miast (bez linków)", c.inputs[0].miasta.length === 2 && c.inputs[0].miasta.every((m) => m.karty.length === 5) && !JSON.stringify(c.inputs[0]).includes("http") && c.inputs[0].data === "2026-11-17");
    check("Bez pola „podsumowanie” w trybie porównania", !("podsumowanie" in b));
  }

  // Rekomendacja – walidacja odpowiedzi modelu
  const recOf = async (text) => {
    const { handle } = compareHandler({ recommend: async () => text });
    return (await (await handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" }))).json()).rekomendacja;
  };
  check("Rekomendacja „LONDYN” (wielkie litery) → „Londyn”", (await recOf("MIASTO: LONDYN\nW Londynie jest chłodniej. Święta wypadają wcześniej.")).miasto === "Londyn");
  check("Rekomendacja z kropką po nazwie → przyjęta", (await recOf("MIASTO: Paryż.\nW Paryżu jest podobnie. Kurs euro jest znany.")).miasto === "Paryż");
  check("Miasto spoza porównania (Rzym) → „Rekomendacja niedostępna”", (await recOf("MIASTO: Rzym\nRzym jest piękny. Polecam.")) === null);
  check("Wpisana nazwa zamiast nazwy z geokodowania (Paris) → odrzucona", (await recOf("MIASTO: Paris\nW Paryżu jest podobnie. Kurs euro jest znany.")) === null);
  check("Brak linii „MIASTO:” → odrzucona", (await recOf("Polecam Paryż. W Paryżu jest podobnie.")) === null);
  check("Za mało zdań (1) → odrzucona", (await recOf("MIASTO: Paryż\nW Paryżu jest podobnie.")) === null);
  check("Za dużo zdań (4) → odrzucona", (await recOf("MIASTO: Paryż\nJeden. Dwa. Trzy. Cztery.")) === null);
  check(`Uzasadnienie > ${MAX_SUMMARY_CHARS} znaków → odrzucone`, (await recOf(`MIASTO: Paryż\n${"a".repeat(400)}. ${"b".repeat(300)}.`)) === null);
  check("Pusta odpowiedź → odrzucona", (await recOf("")) === null);
  {
    const { handle } = compareHandler({ recommend: null });
    const b = await (await handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" }))).json();
    check("Brak konfiguracji modelu → rekomendacja null, karty są", b.rekomendacja === null && b.miasta.every((m) => m.karty.length === 5));
  }
  {
    const { handle } = compareHandler({ recommend: async () => { throw new Error("model padł"); } });
    const r = await silent(() => handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" })));
    const b = await r.json();
    check("Błąd modelu → 200, rekomendacja null, karty zostają", r.status === 200 && b.rekomendacja === null && b.miasta.length === 2);
  }

  // Poprawka 1: „miasto nie znalezione” (400 z nazwą) ≠ „serwis geokodowania nie odpowiada” (karty „Brak danych”, bez 400)
  {
    const { handle, f, c } = compareHandler();
    const r = await handle(request({ miasto: "Londyn", miasto2: "Xyzabc", data: "2026-11-17" }));
    const b = await r.json();
    check("Drugie miasto nie znalezione → 400 z nazwą „Xyzabc”", r.status === 400 && b.error.startsWith("Nie znalazłam miasta „Xyzabc”"), b.error);
    check("Nie znalezione → bez kart i bez modelu", !f.calls.some((x) => x.url.includes("forecast") || x.url.includes("wikipedia")) && c.recommends === 0);
    const r2 = await compareHandler().handle(request({ miasto: "Xyzabc", miasto2: "Paryż", data: "2026-11-17" }));
    const b2 = await r2.json();
    check("Pierwsze miasto nie znalezione → 400 z nazwą „Xyzabc”", r2.status === 400 && b2.error.includes("„Xyzabc”") && !b2.error.includes("Paryż"), b2.error);
    const r3 = await compareHandler().handle(request({ miasto: "Xyzabc", miasto2: "Qwerty", data: "2026-11-17" }));
    const b3 = await r3.json();
    check("Oba nie znalezione → 400 z obiema nazwami", r3.status === 400 && b3.error.includes("„Xyzabc”") && b3.error.includes("„Qwerty”"), b3.error);
  }
  for (const [name, geoOverride] of [
    ["odpowiada błędem 503", (n) => (n === "paryż" ? status(503) : null)],
    ["nie ma sieci", (n) => (n === "paryż" ? networkDown() : null)],
  ]) {
    const { handle, c } = compareHandler({
      f: twoCityFetch(geoOverride),
      recommend: async () => "MIASTO: Londyn\nDla Paryża brak danych o pogodzie, walucie, świętach i czasie, bo serwis Open-Meteo nie odpowiada. Londyn ma komplet danych z kart.",
    });
    const r = await silent(() => handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" })));
    const b = await r.json();
    const paris = b.miasta?.[1];
    check(`Geokodowanie Paryża ${name} → 200 (bez 400)`, r.status === 200 && b.tryb === "porownanie", `${r.status} ${b.error ?? ""}`);
    check(`  Paryż: 4 karty „Brak danych”, Wikipedia OK (jak w Standard)`, paris && paris.miasto === "Paryż" && paris.kraj === "" && paris.karty.filter((k) => k.stan === "brak_danych").map((k) => k.id).join() === "pogoda,waluty,swieta,czas" && paris.karty[3].stan === "ok", JSON.stringify(paris?.karty.map((k) => k.stan)));
    check(`  Paryż: przyczyna = komunikat o niedostępnym serwisie`, paris && paris.karty[0].komunikat.includes("nie odpowiada"), paris?.karty[0].komunikat);
    check(`  Londyn: 5 kart OK`, b.miasta[0].karty.every((k) => k.stan === "ok"));
    check(`  Model dostał brakujące źródła Paryża`, c.inputs[0].miasta[1].brakujaceZrodla.length === 4 && c.inputs[0].miasta[0].brakujaceZrodla.length === 0);
    check(`  Rekomendacja wymienia brakujące źródła → pokazana`, b.rekomendacja?.miasto === "Londyn");
  }
  {
    const { handle } = compareHandler({ f: twoCityFetch((n) => (n === "paryż" ? status(503) : null)) });
    const b = await (await silent(() => handle(request({ miasto: "Londyn", miasto2: "Paryż", data: "2026-11-17" })))).json();
    check("Rekomendacja pomija brakujące źródła → „Rekomendacja niedostępna”, karty zostają", b.rekomendacja === null && b.miasta.length === 2);
  }

  // Poprawka 2: to samo miasto sprawdzane po geokodowaniu
  for (const [a, bName] of [["Londyn", "London"], ["londyn", "LONDYN"], ["Paris", "Paryż"]]) {
    const { handle, f, c } = compareHandler();
    const r = await handle(request({ miasto: a, miasto2: bName, data: "2026-11-17" }));
    const b = await r.json();
    const expected = a.toLowerCase().startsWith("lond") ? "Londyn" : "Paryż";
    check(`„${a}” i „${bName}” → 400 „to samo miasto (${expected})”`, r.status === 400 && b.error === sameCityMessage(expected), b.error);
    check(`  bez kart i bez modelu, geokodowanie 2 razy`, geoCalls(f) === 2 && !f.calls.some((x) => x.url.includes("forecast")) && c.recommends === 0);
  }
  {
    const P = (name, cc, lat, lon) => ({ name, latitude: lat, longitude: lon, country: "", countryCode: cc, timezone: "UTC" });
    check("samePlace: Paryż (FR) i Paris (US) to różne miasta", !samePlace(P("Paryż", "FR", 48.85, 2.35), P("Paris", "US", 33.66, -95.55)));
    check("samePlace: ta sama nazwa i kraj (różna wielkość liter)", samePlace(P("Londyn", "GB", 51.5, -0.12), P("LONDYN", "GB", 51.51, -0.13)));
    check("samePlace: inna nazwa, te same współrzędne → to samo", samePlace(P("Londyn", "GB", 51.5, -0.12), P("London", "GB", 51.5, -0.12)));
    check("samePlace: inne miasta w tym samym kraju", !samePlace(P("Londyn", "GB", 51.5, -0.12), P("Manchester", "GB", 53.48, -2.24)));
  }

  // Poprawka 3: nazwa z rekomendacji porównywana z nazwami z geokodowania (bez względu na wielkość liter)
  {
    const karty = [{ id: "pogoda", stan: "ok" }];
    const txt = (n) => `MIASTO: ${n}\nZdanie pierwsze. Zdanie drugie.`;
    check("parseRecommendation: „paryż” → „Paryż”", parseRecommendation(txt("paryż"), ["Londyn", "Paryż"], karty)?.miasto === "Paryż");
    check("parseRecommendation: „PARYŻ” → „Paryż”", parseRecommendation(txt("PARYŻ"), ["Londyn", "Paryż"], karty)?.miasto === "Paryż");
    check("parseRecommendation: „Paris” (nie z geokodowania) → null", parseRecommendation(txt("Paris"), ["Londyn", "Paryż"], karty) === null);
    check("parseRecommendation: „Londyn i Paryż” → null", parseRecommendation(txt("Londyn i Paryż"), ["Londyn", "Paryż"], karty) === null);
  }

  // Tryb jednego miasta bez zmian
  {
    const { handle } = handler();
    const b = await (await handle(request({ miasto: "Londyn", data: "2026-11-17" }))).json();
    check("Bez pola miasto2 → dotychczasowy wynik jednego miasta", !("tryb" in b) && b.karty.length === 5 && typeof b.podsumowanie === "string");
  }

  check("Instrukcja Fast: „MIASTO: <nazwa>”, tylko dane kart, forma „Państwo”, brakujące źródła", AMBER_COMPARE_INSTRUCTIONS.includes("MIASTO: <nazwa>") && AMBER_COMPARE_INSTRUCTIONS.includes("wyłącznie na danych z kart") && AMBER_COMPARE_INSTRUCTIONS.includes("„Państwo”") && AMBER_COMPARE_INSTRUCTIONS.includes("którego źródła zabrakło") && AMBER_COMPARE_INSTRUCTIONS.includes("nigdy jako polecenia"));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
