// Lekcja 4: narzędzia korzystające z publicznych API bez klucza: pogoda, waluty, swieta, wikipedia.
// Działają tylko na serwerze. Zwracają tylko potrzebne pola + godzinę pobrania.
// Gdy API nie odpowiada albo nie ma danych – zwracają czytelny komunikat po polsku (ok: false), a nie błąd aplikacji.

import { jsonSchema, tool } from "ai";

// Godzina pobrania – czas Londynu (np. „12.11.2026, 18:30:05”). Ta sama postać co w lib/amber-tools-local.ts
// (kopia, bo pliki lib/ nie importują się nawzajem w czasie działania – testy uruchamiają je bez bundlera).
function fetchedAtLabel(date: Date): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export const API_TIMEOUT_MS = 8000;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ApiOptions = { fetch?: FetchLike; now?: () => Date; timeoutMs?: number };

type Check<T> = { success: true; value: T } | { success: false; error: Error };
const ok = <T>(value: T): Check<T> => ({ success: true, value });
const bad = <T>(message: string): Check<T> => ({ success: false, error: new Error(message) });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));

export type ApiFailure = { ok: false; komunikat: string; pobrano: string };
const UNAVAILABLE = (serwis: string) => `Serwis ${serwis} nie odpowiada. Spróbuj ponownie za chwilę.`;

type GetResult = { status: "ok"; data: unknown } | { status: "notFound" } | { status: "error" };

// Pobranie JSON z limitem czasu. 404 = brak danych; inne błędy/timeout/zły JSON = serwis niedostępny.
async function getJson(url: string, options: ApiOptions, headers?: Record<string, string>): Promise<GetResult> {
  const doFetch = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? API_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    if (response.status === 404) return { status: "notFound" };
    if (!response.ok) return { status: "error" };
    const textBody = await response.text();
    if (!textBody.trim()) return { status: "ok", data: null };
    return { status: "ok", data: JSON.parse(textBody) as unknown };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

const nowLabel = (options: ApiOptions) => fetchedAtLabel((options.now ?? (() => new Date()))());
const fail = (komunikat: string, options: ApiOptions): ApiFailure => ({ ok: false, komunikat, pobrano: nowLabel(options) });

// Dzisiejsza data (YYYY-MM-DD) w danej strefie.
function isoDateIn(timeZone: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// pogoda – Open-Meteo: geokodowanie nazwy miasta + prognoza dzienna (do 16 dni)
// ---------------------------------------------------------------------------
export const FORECAST_DAYS = 16;
const WEATHER_CODES: Record<number, string> = {
  0: "bezchmurnie", 1: "przeważnie pogodnie", 2: "częściowe zachmurzenie", 3: "pochmurno",
  45: "mgła", 48: "mgła z szadzią",
  51: "lekka mżawka", 53: "mżawka", 55: "gęsta mżawka", 56: "marznąca mżawka", 57: "gęsta marznąca mżawka",
  61: "lekki deszcz", 63: "deszcz", 65: "ulewny deszcz", 66: "marznący deszcz", 67: "silny marznący deszcz",
  71: "lekki śnieg", 73: "śnieg", 75: "intensywny śnieg", 77: "ziarna śniegu",
  80: "przelotny deszcz", 81: "przelotne opady deszczu", 82: "gwałtowne ulewy",
  85: "przelotny śnieg", 86: "intensywne opady śniegu",
  95: "burza", 96: "burza z gradem", 99: "silna burza z gradem",
};

export type WeatherInput = { miasto: string; data?: string };
export type WeatherResult =
  | {
      ok: true;
      miasto: string;
      kraj: string;
      data: string;
      temperaturaMinC: number;
      temperaturaMaxC: number;
      opadyMm: number;
      opis: string;
      zrodlo: "Open-Meteo";
      pobrano: string;
    }
  | ApiFailure;

export async function getWeather({ miasto, data }: WeatherInput, options: ApiOptions = {}): Promise<WeatherResult> {
  const geoUrl =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({ name: miasto, count: "1", language: "pl", format: "json" }).toString();
  const geo = await getJson(geoUrl, options);
  if (geo.status === "error") return fail(UNAVAILABLE("pogodowy Open-Meteo"), options);
  const place = geo.status === "ok" && isObject(geo.data) && Array.isArray(geo.data.results) ? geo.data.results[0] : undefined;
  if (!isObject(place) || typeof place.latitude !== "number" || typeof place.longitude !== "number") {
    return fail(`Nie znalazłam miasta „${miasto}”. Sprawdź pisownię albo podaj większe miasto w pobliżu.`, options);
  }
  const timeZone = typeof place.timezone === "string" ? place.timezone : "UTC";
  const day = data ?? isoDateIn(timeZone, (options.now ?? (() => new Date()))());

  const forecastUrl =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
      timezone: "auto",
      forecast_days: String(FORECAST_DAYS),
    }).toString();
  const forecast = await getJson(forecastUrl, options);
  if (forecast.status !== "ok") return fail(UNAVAILABLE("pogodowy Open-Meteo"), options);
  const daily = isObject(forecast.data) && isObject(forecast.data.daily) ? forecast.data.daily : null;
  const times = daily && Array.isArray(daily.time) ? daily.time : [];
  const i = times.indexOf(day);
  if (!daily || i < 0) {
    const first = typeof times[0] === "string" ? times[0] : null;
    const last = typeof times[times.length - 1] === "string" ? times[times.length - 1] : null;
    return fail(
      first && last
        ? `Prognoza na ${day} jest niedostępna. Mogę podać prognozę od ${first} do ${last}.`
        : `Prognoza na ${day} jest niedostępna.`,
      options,
    );
  }
  const at = (key: string) => (Array.isArray(daily[key]) ? (daily[key] as unknown[])[i] : undefined);
  const max = at("temperature_2m_max");
  const min = at("temperature_2m_min");
  const rain = at("precipitation_sum");
  const code = at("weather_code");
  if (typeof max !== "number" || typeof min !== "number") return fail(`Prognoza na ${day} jest niedostępna.`, options);
  return {
    ok: true,
    miasto: typeof place.name === "string" ? place.name : miasto,
    kraj: typeof place.country === "string" ? place.country : "",
    data: day,
    temperaturaMinC: min,
    temperaturaMaxC: max,
    opadyMm: typeof rain === "number" ? rain : 0,
    opis: typeof code === "number" ? (WEATHER_CODES[code] ?? "brak opisu") : "brak opisu",
    zrodlo: "Open-Meteo",
    pobrano: nowLabel(options),
  };
}

export function createWeatherTool(options: ApiOptions = {}) {
  return tool({
    description:
      "Prognoza pogody dla miasta na wybrany dzień (dziś lub do 15 dni naprzód): temperatura min/max, opady i opis. " +
      "Użyj, gdy klient pyta o pogodę. Podaj nazwę miasta oraz datę w formacie RRRR-MM-DD (bez daty = dziś). " +
      "Jeśli klient mówi „jutro” albo podaje dzień tygodnia, najpierw ustal datę narzędziem czas.",
    inputSchema: jsonSchema<WeatherInput>(
      {
        type: "object",
        properties: {
          miasto: { type: "string", minLength: 1, maxLength: 100 },
          data: { type: "string", description: "RRRR-MM-DD" },
        },
        required: ["miasto"],
        additionalProperties: false,
      },
      {
        validate: (v) => {
          if (!isObject(v) || !onlyKeys(v, ["miasto", "data"])) return bad("Nieprawidłowe dane pogody.");
          const miasto = typeof v.miasto === "string" ? v.miasto.trim() : "";
          if (!miasto || miasto.length > 100) return bad("Podaj nazwę miasta (do 100 znaków).");
          if (v.data !== undefined && (typeof v.data !== "string" || !isRealDate(v.data))) {
            return bad("Datę podaj w formacie RRRR-MM-DD.");
          }
          return ok({ miasto, ...(typeof v.data === "string" ? { data: v.data } : {}) });
        },
      },
    ),
    execute: async (input) => getWeather(input, options),
  });
}

// ---------------------------------------------------------------------------
// waluty – API NBP: kurs średni waluty w złotych (tabela A, potem B) i przeliczenie kwoty
// ---------------------------------------------------------------------------
export type CurrencyInput = { waluta: string; kwota?: number };
export type CurrencyResult =
  | {
      ok: true;
      waluta: string;
      kod: string;
      kursPLN: number;
      dataKursu: string;
      tabela: "A" | "B";
      kwota?: number;
      kwotaPLN?: number;
      zrodlo: "NBP";
      pobrano: string;
    }
  | ApiFailure;

// Kurs starszy niż tyle dni nie jest podawany jako aktualny (tabela B NBP wychodzi raz w tygodniu).
export const MAX_RATE_AGE_DAYS = 14;

// Tabela A NBP; tabela B TYLKO gdy tabela A odpowie 404 (brak waluty w tabeli A).
// Każdy inny błąd tabeli A = serwis NBP niedostępny (bez przechodzenia do tabeli B).
export async function getCurrency({ waluta, kwota }: CurrencyInput, options: ApiOptions = {}): Promise<CurrencyResult> {
  const code = waluta.toUpperCase();
  if (code === "PLN") return fail("Złoty (PLN) to waluta bazowa – kurs wynosi 1.", options);
  const url = (table: "A" | "B") => `https://api.nbp.pl/api/exchangerates/rates/${table}/${code}/?format=json`;
  let table: "A" | "B" = "A";
  let res = await getJson(url("A"), options);
  if (res.status === "notFound") {
    table = "B";
    res = await getJson(url("B"), options);
  }
  if (res.status === "notFound") {
    return fail(`NBP nie publikuje kursu waluty „${code}”. Podaj trzyliterowy kod, np. EUR, USD, GBP.`, options);
  }
  if (res.status === "error") return fail(UNAVAILABLE("NBP"), options);
  const d = res.data;
  const rate = isObject(d) && Array.isArray(d.rates) ? d.rates[0] : undefined;
  if (!isObject(d) || !isObject(rate) || typeof rate.mid !== "number" || !Number.isFinite(rate.mid) || rate.mid <= 0) {
    return fail(UNAVAILABLE("NBP"), options);
  }
  const effectiveDate = typeof rate.effectiveDate === "string" ? rate.effectiveDate : "";
  if (!isRealDate(effectiveDate)) return fail(UNAVAILABLE("NBP"), options);
  const nowDate = (options.now ?? (() => new Date()))();
  const ageDays = (Date.parse(isoDateIn("Europe/Warsaw", nowDate)) - Date.parse(effectiveDate)) / 86_400_000;
  if (ageDays > MAX_RATE_AGE_DAYS) {
    return fail(
      `Najnowszy kurs waluty „${code}” w NBP pochodzi z ${effectiveDate} (starszy niż ${MAX_RATE_AGE_DAYS} dni), ` +
        "więc nie podaję go jako aktualnego.",
      options,
    );
  }
  return {
    ok: true,
    waluta: typeof d.currency === "string" ? d.currency : code,
    kod: typeof d.code === "string" ? d.code : code,
    kursPLN: rate.mid,
    dataKursu: effectiveDate,
    tabela: table,
    ...(kwota !== undefined ? { kwota, kwotaPLN: Math.round(kwota * rate.mid * 100) / 100 } : {}),
    zrodlo: "NBP",
    pobrano: nowLabel(options),
  };
}

export function createCurrencyTool(options: ApiOptions = {}) {
  return tool({
    description:
      "Aktualny średni kurs waluty wobec złotego (PLN) według NBP i opcjonalnie przeliczenie kwoty na złote. " +
      "Użyj, gdy klient pyta o kurs waluty albo ile złotych to podana kwota w obcej walucie. " +
      "Podaj trzyliterowy kod ISO (np. EUR, USD, GBP).",
    inputSchema: jsonSchema<CurrencyInput>(
      {
        type: "object",
        properties: {
          waluta: { type: "string", pattern: "^[A-Za-z]{3}$" },
          kwota: { type: "number", minimum: 0 },
        },
        required: ["waluta"],
        additionalProperties: false,
      },
      {
        validate: (v) => {
          if (!isObject(v) || !onlyKeys(v, ["waluta", "kwota"])) return bad("Nieprawidłowe dane waluty.");
          if (typeof v.waluta !== "string" || !/^[A-Za-z]{3}$/.test(v.waluta)) {
            return bad("Podaj trzyliterowy kod waluty, np. EUR.");
          }
          if (v.kwota !== undefined && (typeof v.kwota !== "number" || !Number.isFinite(v.kwota) || v.kwota < 0 || v.kwota > 1e12)) {
            return bad("Kwota musi być liczbą od 0 do 10^12.");
          }
          return ok({ waluta: v.waluta.toUpperCase(), ...(typeof v.kwota === "number" ? { kwota: v.kwota } : {}) });
        },
      },
    ),
    execute: async (input) => getCurrency(input, options),
  });
}

// ---------------------------------------------------------------------------
// swieta – Nager.Date: dni wolne od pracy w kraju i roku
// ---------------------------------------------------------------------------
export type HolidaysInput = { kraj: string; rok: number };
// regiony – tylko gdy Nager.Date je zwraca (pole counties, np. „GB-SCT”). Brak pola = API nie wskazało regionu.
// ogolnokrajowe – pole „global” z Nager.Date (true = cały kraj, false = tylko część kraju). Brak pola = API nie podało zakresu.
export type Holiday = { data: string; nazwaLokalna: string; nazwa: string; ogolnokrajowe?: boolean; regiony?: string[] };
// Czytelne nazwy kodów regionów (ISO 3166-2). Nieznane kody pokazujemy bez zmian.
const REGION_NAMES: Record<string, string> = {
  "GB-ENG": "Anglia",
  "GB-WLS": "Walia",
  "GB-SCT": "Szkocja",
  "GB-NIR": "Irlandia Północna",
};
function regionsOf(counties: unknown): string[] | undefined {
  if (!Array.isArray(counties)) return undefined;
  const list = counties
    .filter((c): c is string => typeof c === "string" && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(c))
    .slice(0, 20)
    .map((c) => REGION_NAMES[c] ?? c);
  return list.length > 0 ? list : undefined;
}
export type HolidaysResult =
  | { ok: true; kraj: string; rok: number; swieta: Holiday[]; zrodlo: "Nager.Date"; pobrano: string }
  | ApiFailure;

export async function getHolidays({ kraj, rok }: HolidaysInput, options: ApiOptions = {}): Promise<HolidaysResult> {
  const cc = kraj.toUpperCase();
  const res = await getJson(`https://date.nager.at/api/v3/PublicHolidays/${rok}/${cc}`, options);
  if (res.status === "error") return fail(UNAVAILABLE("Nager.Date"), options);
  const unknownCountry = `Nie mam listy świąt dla kraju „${cc}”. Podaj dwuliterowy kod kraju, np. PL, GB, DE.`;
  if (res.status === "notFound" || !Array.isArray(res.data) || res.data.length === 0) return fail(unknownCountry, options);
  const swieta: Holiday[] = res.data
    .filter(isObject)
    .filter((h) => typeof h.date === "string")
    .slice(0, 40)
    .map((h) => {
      const regiony = regionsOf(h.counties);
      return {
        data: h.date as string,
        nazwaLokalna: typeof h.localName === "string" ? h.localName : "",
        nazwa: typeof h.name === "string" ? h.name : "",
        ...(typeof h.global === "boolean" ? { ogolnokrajowe: h.global } : {}),
        ...(regiony ? { regiony } : {}),
      };
    });
  if (swieta.length === 0) return fail(unknownCountry, options);
  return { ok: true, kraj: cc, rok, swieta, zrodlo: "Nager.Date", pobrano: nowLabel(options) };
}

export function createHolidaysTool(options: ApiOptions = {}) {
  return tool({
    description:
      "Lista dni wolnych od pracy (świąt państwowych) w podanym kraju i roku. Pole ogolnokrajowe: true = cały kraj, " +
      "false = tylko część kraju (regiony podane w polu regiony, jeśli są). Bez tych pól nie określaj zakresu ani regionu. " +
      "Użyj, gdy klient pyta o święta, " +
      "dni wolne lub bank holidays. Podaj dwuliterowy kod kraju ISO (PL, GB, DE…) i rok. " +
      "Dla Wielkiej Brytanii użyj GB. Bieżący rok ustal narzędziem czas, jeśli nie jest podany.",
    inputSchema: jsonSchema<HolidaysInput>(
      {
        type: "object",
        properties: {
          kraj: { type: "string", pattern: "^[A-Za-z]{2}$" },
          rok: { type: "integer", minimum: 1975, maximum: 2075 },
        },
        required: ["kraj", "rok"],
        additionalProperties: false,
      },
      {
        validate: (v) => {
          if (!isObject(v) || !onlyKeys(v, ["kraj", "rok"])) return bad("Nieprawidłowe dane świąt.");
          if (typeof v.kraj !== "string" || !/^[A-Za-z]{2}$/.test(v.kraj)) return bad("Podaj dwuliterowy kod kraju, np. PL.");
          if (typeof v.rok !== "number" || !Number.isInteger(v.rok) || v.rok < 1975 || v.rok > 2075) {
            return bad("Rok musi być liczbą całkowitą od 1975 do 2075.");
          }
          return ok({ kraj: v.kraj.toUpperCase(), rok: v.rok });
        },
      },
    ),
    execute: async (input) => getHolidays(input, options),
  });
}

// ---------------------------------------------------------------------------
// wikipedia – krótkie streszczenie hasła z polskiej Wikipedii + link
// ---------------------------------------------------------------------------
export const WIKI_USER_AGENT = "AmberChatbot/1.0 (projekt szkoleniowy; https://github.com/AmberMal/moj-chatbot)";
const MAX_EXTRACT_CHARS = 1200;
export type WikiResult =
  | { ok: true; tytul: string; streszczenie: string; link: string; zrodlo: "Wikipedia (pl)"; pobrano: string }
  | ApiFailure;

export async function getWikipedia({ haslo }: { haslo: string }, options: ApiOptions = {}): Promise<WikiResult> {
  const title = encodeURIComponent(haslo.trim().replace(/\s+/g, "_"));
  const res = await getJson(`https://pl.wikipedia.org/api/rest_v1/page/summary/${title}`, options, {
    "Api-User-Agent": WIKI_USER_AGENT,
    "User-Agent": WIKI_USER_AGENT,
  });
  if (res.status === "error") return fail(UNAVAILABLE("Wikipedia"), options);
  const notFound = `W polskiej Wikipedii nie ma hasła „${haslo}”. Spróbuj innej nazwy.`;
  if (res.status === "notFound" || !isObject(res.data)) return fail(notFound, options);
  const d = res.data;
  const link =
    isObject(d.content_urls) && isObject(d.content_urls.desktop) && typeof d.content_urls.desktop.page === "string"
      ? d.content_urls.desktop.page
      : `https://pl.wikipedia.org/wiki/${title}`;
  if (d.type === "disambiguation") {
    return fail(`Hasło „${haslo}” ma kilka znaczeń. Doprecyzuj, o które chodzi (lista znaczeń: ${link}).`, options);
  }
  const extract = typeof d.extract === "string" ? d.extract.trim() : "";
  if (!extract) return fail(notFound, options);
  return {
    ok: true,
    tytul: typeof d.title === "string" ? d.title : haslo,
    streszczenie: extract.length > MAX_EXTRACT_CHARS ? `${extract.slice(0, MAX_EXTRACT_CHARS)}…` : extract,
    link,
    zrodlo: "Wikipedia (pl)",
    pobrano: nowLabel(options),
  };
}

export function createWikipediaTool(options: ApiOptions = {}) {
  return tool({
    description:
      "Krótkie streszczenie hasła z polskiej Wikipedii wraz z linkiem do artykułu. Użyj, gdy klient pyta, czym jest " +
      "pojęcie, miejsce, osoba lub rzecz o charakterze encyklopedycznym. Nie używaj do informacji o Amber " +
      "(ceny, usługi, zasady – tylko baza wiedzy). Podaj samo hasło, np. „Monitoring wizyjny”.",
    inputSchema: jsonSchema<{ haslo: string }>(
      {
        type: "object",
        properties: { haslo: { type: "string", minLength: 1, maxLength: 200 } },
        required: ["haslo"],
        additionalProperties: false,
      },
      {
        validate: (v) => {
          if (!isObject(v) || !onlyKeys(v, ["haslo"])) return bad("Nieprawidłowe dane Wikipedii.");
          const haslo = typeof v.haslo === "string" ? v.haslo.trim() : "";
          if (!haslo || haslo.length > 200) return bad("Podaj hasło do wyszukania (do 200 znaków).");
          return ok({ haslo });
        },
      },
    ),
    execute: async (input) => getWikipedia(input, options),
  });
}
