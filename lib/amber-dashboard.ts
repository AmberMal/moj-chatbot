// Lekcja 4, Warsztat 3 (poziom Minimum): Dashboard podróży – jedno miasto, 5 kart i krótkie podsumowanie agenta.
// Ten plik działa tylko na serwerze. Dane pobierają ISTNIEJĄCE funkcje narzędzi agenta (lib/amber-tools-api.ts,
// lib/amber-tools-local.ts) – są przekazywane z zewnątrz (app/api/dashboard/route.ts), tak jak w createAgentHandler,
// żeby logikę dało się przetestować bez internetu i bez modelu (scripts/test-amber-dashboard.mjs).
// Poziom Standard: każda karta ma stan „OK” albo „Brak danych” („Ładuję…” pokazuje przeglądarka w czasie pobierania).
// Gdy jedno źródło zawiedzie, pozostałe karty działają; nigdy nie wstawiamy danych zastępczych ani wymyślonych.
// Podsumowanie agenta musi wprost wskazać brakujące źródło (sprawdza to serwer).

export type CardId = "pogoda" | "waluty" | "swieta" | "wikipedia" | "czas";
export type CardState = "ok" | "brak_danych";
export type DashboardCard = {
  id: CardId;
  tytul: string;
  ok: boolean;
  stan: CardState; // Standard: „OK” / „Brak danych”
  wartosc: string; // główna wartość (gdy ok)
  jednostka?: string;
  szczegoly?: string;
  komunikat?: string; // komunikat zwrócony przez funkcję narzędzia (gdy !ok)
  link?: string;
  zrodlo: string;
  pobrano: string;
};
export type DashboardResult = {
  miasto: string;
  kraj: string;
  data: string;
  karty: DashboardCard[];
  podsumowanie: string | null; // null = „Podsumowanie niedostępne”
};

// Kształty wyników istniejących funkcji (tylko pola używane przez Dashboard).
type Fail = { ok: false; komunikat: string; pobrano: string };
type Place = { name: string; latitude: number; longitude: number; country: string; countryCode: string; timezone: string };
type Holiday = { data: string; nazwaLokalna: string; nazwa: string; ogolnokrajowe?: boolean; regiony?: string[] };

export type DashboardSources = {
  geocodeCity: (miasto: string) => Promise<{ ok: true; place: Place } | Fail>;
  getWeather: (
    input: { miasto: string; data?: string },
    place: Place,
  ) => Promise<
    | { ok: true; miasto: string; data: string; temperaturaMinC: number; temperaturaMaxC: number; opadyMm: number; opis: string; zrodlo: string; pobrano: string }
    | Fail
  >;
  getCurrency: (input: { waluta: string }) => Promise<
    { ok: true; kod: string; kursPLN: number; dataKursu: string; zrodlo: string; pobrano: string } | Fail
  >;
  getHolidays: (input: { kraj: string; rok: number }) => Promise<
    { ok: true; kraj: string; rok: number; swieta: Holiday[]; zrodlo: string; pobrano: string } | Fail
  >;
  getWikipedia: (input: { haslo: string }) => Promise<
    { ok: true; tytul: string; streszczenie: string; link: string; zrodlo: string; pobrano: string } | Fail
  >;
  timeIn: (strefa: string, now: Date) => { ok: true; strefa: string; data: string; dzienTygodnia: string; godzina: string; pobrano: string } | Fail;
};

export type DashboardDeps = {
  // 1. Sesja (wywoływana jako pierwsza). false = brak ważnej sesji → 401.
  hasSession: (req: Request) => boolean;
  sources: DashboardSources;
  // Podsumowanie agenta: dane kart → 2–3 zdania. null = brak konfiguracji modelu.
  summarize:
    | ((input: { miasto: string; kraj: string; data: string; karty: unknown[]; brakujaceZrodla: string[] }) => Promise<string>)
    | null;
  now?: () => Date;
  log?: (message: string) => void;
};

export const DASHBOARD_MESSAGES = {
  unauthorized: "Brak dostępu: zaloguj się hasłem warsztatowym.",
  badRequest: "Nieprawidłowe zapytanie. Odśwież stronę i spróbuj ponownie.",
  noCity: "Wpisz miasto (od 1 do 100 znaków).",
  badDate: "Podaj datę w formacie RRRR-MM-DD.",
  summaryUnavailable: "Podsumowanie niedostępne",
} as const;
export const MAX_SUMMARY_CHARS = 600;
// Podsumowanie agenta: 2–3 zdania (wymaganie lekcji). Inna liczba → „Podsumowanie niedostępne”.
export const MIN_SUMMARY_SENTENCES = 2;
export const MAX_SUMMARY_SENTENCES = 3;

// Liczba zdań: tekst dzielony po kropce, wykrzykniku, pytajniku lub wielokropku, po których jest odstęp.
// (Liczby i daty, np. „12,5” albo „17.11.2026”, nie mają odstępu po kropce, więc nie dzielą zdania.)
export function countSentences(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((part) => part.trim().length > 0).length;
}

// Waluta kraju docelowego (kod ISO kraju → kod waluty NBP).
export const COUNTRY_CURRENCY: Record<string, string> = {
  // strefa euro (oraz kraje używające euro)
  AT: "EUR", BE: "EUR", BG: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR", DE: "EUR", GR: "EUR",
  IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR",
  ES: "EUR", AD: "EUR", MC: "EUR", SM: "EUR", VA: "EUR", ME: "EUR", XK: "EUR",
  GB: "GBP", US: "USD", CH: "CHF", LI: "CHF", CZ: "CZK", HU: "HUF", SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK",
  RO: "RON", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD", KR: "KRW", IN: "INR",
  TH: "THB", TR: "TRY", UA: "UAH", IL: "ILS", MX: "MXN", BR: "BRL", ZA: "ZAR", AE: "AED", EG: "EGP", MA: "MAD",
  GE: "GEL", RS: "RSD", AL: "ALL", BA: "BAM", MK: "MKD", MD: "MDL", CL: "CLP", AR: "ARS", PH: "PHP", MY: "MYR",
  ID: "IDR", VN: "VND",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const plNum = (n: number) => n.toLocaleString("pl-PL", { maximumFractionDigits: 4 });

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function fetchedLabel(date: Date): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

// Przesunięcie strefy względem UTC (w minutach) w danej chwili.
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

// Różnica czasu miejsca względem Polski, np. „−1 h”, „0 h”, „+5,5 h”.
export function differenceFromPoland(timeZone: string, at: Date): string {
  const minutes = offsetMinutes(timeZone, at) - offsetMinutes("Europe/Warsaw", at);
  if (minutes === 0) return "0 h";
  const hours = plNum(Math.abs(minutes) / 60);
  return `${minutes > 0 ? "+" : "−"}${hours} h`;
}

// Pierwsze dwa zdania tekstu.
export function firstSentences(text: string, count = 2): string {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  return sentences.slice(0, count).join(" ");
}

function holidayScope(h: Holiday): string {
  if (h.ogolnokrajowe === true) return " (cały kraj)";
  if (h.regiony && h.regiony.length > 0) return ` (${h.regiony.join(", ")})`;
  return "";
}
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

type RawCard = Omit<DashboardCard, "stan">;

// Opis kart: tytuł, nazwa źródła i słowa, po których rozpoznajemy, że podsumowanie wspomina o tej karcie.
export const CARD_META: Record<CardId, { tytul: string; zrodlo: string; slowa: string[] }> = {
  pogoda: { tytul: "Pogoda", zrodlo: "Open-Meteo", slowa: ["pogod", "prognoz", "open-meteo"] },
  waluty: { tytul: "Waluty", zrodlo: "NBP", slowa: ["walut", "waluc", "kurs", "nbp"] },
  swieta: { tytul: "Święta", zrodlo: "Nager.Date", slowa: ["święt", "świąt", "swiet", "swiat", "dni woln", "nager"] },
  wikipedia: { tytul: "Wikipedia", zrodlo: "Wikipedia (pl)", slowa: ["wikipedi"] },
  czas: { tytul: "Czas", zrodlo: "zegar serwera", slowa: ["czas", "godzin", "stref"] },
};
const CARD_ORDER: CardId[] = ["pogoda", "waluty", "swieta", "wikipedia", "czas"];

// Karta „Brak danych” – bez żadnych danych zastępczych; komunikat = przyczyna (z narzędzia albo wyjątku).
export function missingCard(id: CardId, komunikat: string, now: Date, zrodlo?: string): DashboardCard {
  return {
    id,
    tytul: CARD_META[id].tytul,
    ok: false,
    stan: "brak_danych",
    wartosc: "",
    komunikat,
    zrodlo: zrodlo ?? CARD_META[id].zrodlo,
    pobrano: fetchedLabel(now),
  };
}

// Nazwy brakujących źródeł, np. „Waluty (NBP)”.
export function missingSources(karty: DashboardCard[]): string[] {
  return karty.filter((k) => k.stan === "brak_danych").map((k) => `${CARD_META[k.id].tytul} (${CARD_META[k.id].zrodlo})`);
}

// Czy podsumowanie wprost wymienia każdą kartę bez danych (po nazwie karty albo źródła).
export function summaryNamesMissing(text: string, karty: DashboardCard[]): boolean {
  const lower = text.toLowerCase();
  return karty
    .filter((k) => k.stan === "brak_danych")
    .every((k) => CARD_META[k.id].slowa.some((w) => lower.includes(w)));
}

async function wikipediaCard(haslo: string, sources: DashboardSources): Promise<DashboardCard> {
  const r = await sources.getWikipedia({ haslo });
  const base = { id: "wikipedia" as const, tytul: "Wikipedia", zrodlo: "Wikipedia (pl)", pobrano: r.pobrano };
  if (!r.ok) return { ...base, ok: false, stan: "brak_danych", wartosc: "", komunikat: r.komunikat };
  return { ...base, ok: true, stan: "ok", wartosc: r.tytul, szczegoly: firstSentences(r.streszczenie, 2), link: r.link, zrodlo: r.zrodlo };
}

// Każda karta osobno: wyjątek w jednej karcie daje tylko tej karcie „Brak danych”.
function isolate(id: CardId, card: Promise<DashboardCard>, now: Date): Promise<DashboardCard> {
  return card
    .then((c) => ({ ...c, stan: (c.ok ? "ok" : "brak_danych") as CardState }))
    .catch((error) => {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[Amber] /api/dashboard – błąd karty ${id}: ${details.slice(0, 300)}`);
      return missingCard(id, "Źródło nie zwróciło danych.", now);
    });
}

// Geokodowanie niedostępne: bez kraju i strefy czasowej działa tylko Wikipedia (po nazwie miasta); reszta – „Brak danych”.
export async function buildCardsWithoutPlace(miasto: string, komunikat: string, sources: DashboardSources, now: Date): Promise<DashboardCard[]> {
  return Promise.all(
    CARD_ORDER.map((id) =>
      id === "wikipedia" ? isolate(id, wikipediaCard(miasto, sources), now) : Promise.resolve(missingCard(id, komunikat, now, id === "czas" ? "zegar serwera (strefa z Open-Meteo)" : undefined)),
    ),
  );
}

// 5 kart dla jednego miasta (geokodowanie wykonane wcześniej – dokładnie raz).
export async function buildCityCards(
  place: Place,
  data: string,
  sources: DashboardSources,
  now: Date,
): Promise<DashboardCard[]> {
  const pogoda = (async (): Promise<RawCard> => {
    const r = await sources.getWeather({ miasto: place.name, data }, place);
    const base = { id: "pogoda" as const, tytul: "Pogoda", zrodlo: "Open-Meteo", pobrano: r.pobrano };
    if (!r.ok) return { ...base, ok: false, wartosc: "", komunikat: r.komunikat };
    return {
      ...base,
      ok: true,
      wartosc: `${plNum(r.temperaturaMinC)}–${plNum(r.temperaturaMaxC)}`,
      jednostka: "°C",
      szczegoly: `${dmy(r.data)}: ${r.opis}, opady ${plNum(r.opadyMm)} mm`,
      zrodlo: r.zrodlo,
    };
  })();

  const waluty = (async (): Promise<RawCard> => {
    const code = place.countryCode;
    if (code === "PL") {
      return { id: "waluty", tytul: "Waluty", ok: true, wartosc: "złoty (PLN)", szczegoly: "waluta lokalna – przeliczenie niepotrzebne", zrodlo: "NBP (waluta bazowa)", pobrano: fetchedLabel(now) };
    }
    const waluta = COUNTRY_CURRENCY[code];
    if (!waluta) {
      return { id: "waluty", tytul: "Waluty", ok: false, wartosc: "", komunikat: `Nie mam przypisanej waluty dla kraju ${place.country || code}.`, zrodlo: "NBP", pobrano: fetchedLabel(now) };
    }
    const r = await sources.getCurrency({ waluta });
    const base = { id: "waluty" as const, tytul: "Waluty", zrodlo: "NBP", pobrano: r.pobrano };
    if (!r.ok) return { ...base, ok: false, wartosc: "", komunikat: r.komunikat };
    return { ...base, ok: true, wartosc: `1 ${r.kod} = ${plNum(r.kursPLN)}`, jednostka: "zł", szczegoly: `kurs średni NBP z ${dmy(r.dataKursu)}`, zrodlo: r.zrodlo };
  })();

  const swieta = (async (): Promise<RawCard> => {
    const rok = Number(data.slice(0, 4));
    const first = await sources.getHolidays({ kraj: place.countryCode, rok });
    const base = { id: "swieta" as const, tytul: "Święta", zrodlo: "Nager.Date", pobrano: first.pobrano };
    if (!first.ok) return { ...base, ok: false, wartosc: "", komunikat: first.komunikat };
    let upcoming = first.swieta.filter((h) => h.data >= data);
    if (upcoming.length < 3) {
      const next = await sources.getHolidays({ kraj: place.countryCode, rok: rok + 1 });
      if (next.ok) upcoming = [...upcoming, ...next.swieta.filter((h) => h.data >= data)];
    }
    const lista = upcoming.slice(0, 3);
    if (lista.length === 0) return { ...base, ok: true, wartosc: "brak", szczegoly: `Brak dni wolnych od ${dmy(data)} w danych źródła.`, zrodlo: first.zrodlo };
    return {
      ...base,
      ok: true,
      wartosc: `${dmy(lista[0].data)} – ${lista[0].nazwaLokalna}`,
      szczegoly: lista.map((h) => `${dmy(h.data)} – ${h.nazwaLokalna}${holidayScope(h)}`).join("\n"),
      zrodlo: first.zrodlo,
    };
  })();

  const wikipedia = wikipediaCard(place.name, sources);

  const czas = (async (): Promise<RawCard> => {
    const r = sources.timeIn(place.timezone, now);
    const base = { id: "czas" as const, tytul: "Czas", zrodlo: `zegar serwera, strefa ${place.timezone}`, pobrano: r.pobrano };
    if (!r.ok) return { ...base, ok: false, wartosc: "", komunikat: r.komunikat };
    return {
      ...base,
      ok: true,
      wartosc: r.godzina,
      szczegoly: `${r.dzienTygodnia}, ${r.data}; różnica względem Polski: ${differenceFromPoland(place.timezone, now)}`,
    };
  })();

  const asCard = (p: Promise<RawCard | DashboardCard>) => p.then((c) => ({ ...c, stan: (c.ok ? "ok" : "brak_danych") as CardState }));
  return Promise.all([
    isolate("pogoda", asCard(pogoda), now),
    isolate("waluty", asCard(waluty), now),
    isolate("swieta", asCard(swieta), now),
    isolate("wikipedia", wikipedia, now),
    isolate("czas", asCard(czas), now),
  ]);
}

// Dane kart dla modelu – tylko treść kart (bez linków i identyfikatorów technicznych).
export function cardsForModel(karty: DashboardCard[]): unknown[] {
  return karty.map((k) =>
    k.ok
      ? { karta: k.tytul, wartosc: [k.wartosc, k.jednostka].filter(Boolean).join(" "), szczegoly: k.szczegoly ?? "", zrodlo: k.zrodlo, pobrano: k.pobrano }
      : { karta: k.tytul, stan: "brak danych", zrodlo: CARD_META[k.id].zrodlo, przyczyna: k.komunikat ?? "", pobrano: k.pobrano },
  );
}

export function createDashboardHandler(deps: DashboardDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));

  return async function handleDashboardRequest(req: Request): Promise<Response> {
    // 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie pobrane.
    if (!deps.hasSession(req)) return json({ error: DASHBOARD_MESSAGES.unauthorized }, 401);

    // 2. Dane wejściowe.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: DASHBOARD_MESSAGES.badRequest }, 400);
    }
    if (!isObject(body) || !Object.keys(body).every((k) => k === "miasto" || k === "data")) {
      return json({ error: DASHBOARD_MESSAGES.badRequest }, 400);
    }
    const miasto = typeof body.miasto === "string" ? body.miasto.trim() : "";
    if (!miasto || miasto.length > 100) return json({ error: DASHBOARD_MESSAGES.noCity }, 400);
    const data = typeof body.data === "string" ? body.data : "";
    if (!isRealDate(data)) return json({ error: DASHBOARD_MESSAGES.badDate }, 400);

    // 3. Geokodowanie miasta – dokładnie raz (wynik używają karty Pogoda, Waluty, Święta, Wikipedia i Czas).
    //    Nieznane miasto → 400 (jak w Minimum). Geokodowanie niedostępne → karty bez danych (oprócz Wikipedii), status 200.
    const at = now();
    let geo: Awaited<ReturnType<DashboardSources["geocodeCity"]>>;
    try {
      geo = await deps.sources.geocodeCity(miasto);
    } catch {
      geo = { ok: false, komunikat: "Serwis pogodowy Open-Meteo nie odpowiada. Spróbuj ponownie za chwilę.", pobrano: fetchedLabel(at) };
    }
    if (!geo.ok && geo.komunikat.startsWith("Nie znalazłam miasta")) return json({ error: geo.komunikat }, 400);

    // 4. Pięć kart (istniejące funkcje narzędzi), każda niezależnie.
    const place = geo.ok ? geo.place : null;
    const karty = place
      ? await buildCityCards(place, data, deps.sources, at)
      : await buildCardsWithoutPlace(miasto, geo.ok ? "" : geo.komunikat, deps.sources, at);
    const brakujaceZrodla = missingSources(karty);

    // 5. Podsumowanie agenta – tylko na podstawie kart. Przy problemie: „Podsumowanie niedostępne”, karty zostają.
    let podsumowanie: string | null = null;
    if (deps.summarize) {
      try {
        const text = (
          await deps.summarize({
            miasto: place?.name ?? miasto,
            kraj: place?.country ?? "",
            data,
            karty: cardsForModel(karty),
            brakujaceZrodla,
          })
        ).trim();
        const sentences = countSentences(text);
        const namesMissing = summaryNamesMissing(text, karty);
        if (
          text.length > 0 &&
          text.length <= MAX_SUMMARY_CHARS &&
          sentences >= MIN_SUMMARY_SENTENCES &&
          sentences <= MAX_SUMMARY_SENTENCES &&
          namesMissing
        ) {
          podsumowanie = text;
        } else {
          log(
            `[Amber] /api/dashboard – podsumowanie odrzucone (długość ${text.length}, zdań: ${sentences}, ` +
              `brakujące źródła wymienione: ${namesMissing ? "tak" : "nie"}).`,
          );
        }
      } catch (error) {
        const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.error(`[Amber] /api/dashboard – błąd podsumowania: ${details.slice(0, 300)}`);
      }
    }

    const result: DashboardResult = { miasto: place?.name ?? miasto, kraj: place?.country ?? "", data, karty, podsumowanie };
    return json(result);
  };
}
