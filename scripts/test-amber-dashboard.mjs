// Testy lekcji 4, Warsztat 3 (Minimum): Dashboard podróży – BEZ internetu (sztuczny fetch) i BEZ modelu.
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
  differenceFromPoland,
  firstSentences,
} from "../lib/amber-dashboard.ts";
import { geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia } from "../lib/amber-tools-api.ts";
import { timeIn } from "../lib/amber-tools-local.ts";
import { AMBER_CHAT_INSTRUCTIONS, AMBER_DASHBOARD_INSTRUCTIONS } from "../lib/amber-instructions.ts";

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
  check("Endpoint: sesja przez isSessionValid, te same funkcje narzędzi", route.includes("isSessionValid(token, authConfig)") && /geocodeCity, getCurrency, getHolidays, getWeather, getWikipedia/.test(route) && route.includes("timeIn"));
  check("Endpoint: podsumowanie bez narzędzi (brak tools w generateText)", !/tools\s*:/.test(route));
  check("Strona: sesja sprawdzana na serwerze, bez sesji ekran hasła", page.includes("isSessionValid(token, config)") && page.includes("<LoginForm"));
  check("Link powrotny do czatu", page.includes('href="/"') && page.includes("Wróć do czatu"));
  check("Link do Dashboardu w nagłówku czatu", chat.includes('href="/dashboard"') && chat.includes("Dashboard podróży"));
  check("Formularz: „Dokąd jedziesz?”, „Kiedy?”, „Sprawdź”, „Odśwież”", ["Dokąd jedziesz?", "Kiedy?", '"Sprawdź"', '"Odśwież"'].every((t) => ui.includes(t)));
  check("„Podsumowanie niedostępne” przy braku podsumowania", ui.includes('result.podsumowanie ?? "Podsumowanie niedostępne"'));
  check("Minimum: bez trybu porównania", !/porown|Porównaj/i.test(ui + route));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
