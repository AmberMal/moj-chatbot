// Lekcja 4, Warsztat 3 (poziom Minimum): Dashboard podróży – jedno miasto, 5 kart i krótkie podsumowanie agenta.
// Poziom Fast: tryb „Porównaj” (pole „miasto2”) – dwa miasta, wspólna data, rekomendacja jednego miasta.
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

// Poziom Fast: tryb „Porównaj” – dwa miasta, wspólna data, po 5 kart na miasto i rekomendacja jednego miasta.
export type CompareCity = { miasto: string; kraj: string; karty: DashboardCard[] };
export type CompareRecommendation = { miasto: string; uzasadnienie: string };
export type CompareResult = {
  tryb: "porownanie";
  data: string;
  miasta: [CompareCity, CompareCity];
  rekomendacja: CompareRecommendation | null; // null = „Rekomendacja niedostępna”
};
export type RecommendInput = {
  data: string;
  miasta: { miasto: string; kraj: string; karty: unknown[]; brakujaceZrodla: string[] }[];
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
  hasSession: (req: Request) => boolean | Promise<boolean>;
  sources: DashboardSources;
  // Podsumowanie agenta: dane kart → 2–3 zdania. null = brak konfiguracji modelu.
  summarize:
    | ((input: { miasto: string; kraj: string; data: string; karty: unknown[]; brakujaceZrodla: string[] }) => Promise<string>)
    | null;
  // Fast: rekomendacja jednego z dwóch miast (tylko dane kart). null = brak konfiguracji modelu.
  recommend?: ((input: RecommendInput) => Promise<string>) | null;
  now?: () => Date;
  log?: (message: string) => void;
};

export const DASHBOARD_MESSAGES = {
  unauthorized: "Brak dostępu: zaloguj się na swoje konto.",
  badRequest: "Nieprawidłowe zapytanie. Odśwież stronę i spróbuj ponownie.",
  noCity: "Wpisz miasto (od 1 do 100 znaków).",
  badDate: "Podaj datę w formacie RRRR-MM-DD.",
  summaryUnavailable: "Podsumowanie niedostępne",
  noCity2: "Wpisz drugie miasto (od 1 do 100 znaków).",
  recommendationUnavailable: "Rekomendacja niedostępna",
} as const;
export const sameCityMessage = (name: string) => `Oba pola wskazują to samo miasto (${name}). Wybierz dwa różne miasta.`;
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

// Geokodowanie jednego miasta – dokładnie raz. Trzy wyniki:
//   „not_found”   – źródło odpowiedziało, ale miasta nie ma (→ 400 z nazwą miasta),
//   „unavailable” – serwis geokodowania nie odpowiada (→ karty „Brak danych” jak w Standard, bez 400),
//   „ok”          – mamy miejsce (nazwa, kraj, strefa czasowa, współrzędne).
type GeoStep =
  | { kind: "ok"; place: Place }
  | { kind: "not_found"; komunikat: string }
  | { kind: "unavailable"; komunikat: string };

async function geocodeStep(miasto: string, sources: DashboardSources, at: Date): Promise<GeoStep> {
  let geo: Awaited<ReturnType<DashboardSources["geocodeCity"]>>;
  try {
    geo = await sources.geocodeCity(miasto);
  } catch {
    geo = { ok: false, komunikat: "Serwis pogodowy Open-Meteo nie odpowiada. Spróbuj ponownie za chwilę.", pobrano: fetchedLabel(at) };
  }
  if (geo.ok) return { kind: "ok", place: geo.place };
  if (geo.komunikat.startsWith("Nie znalazłam miasta")) return { kind: "not_found", komunikat: geo.komunikat };
  return { kind: "unavailable", komunikat: geo.komunikat };
}

function cardsForStep(miasto: string, step: GeoStep, data: string, sources: DashboardSources, at: Date): Promise<DashboardCard[]> {
  return step.kind === "ok"
    ? buildCityCards(step.place, data, sources, at)
    : buildCardsWithoutPlace(miasto, step.komunikat, sources, at);
}

const lowerPl = (s: string) => s.trim().toLocaleLowerCase("pl-PL");

// Fast: to samo miasto – porównanie PO geokodowaniu (np. „Londyn” i „London” → to samo miejsce).
// Ten sam kraj i ta sama nazwa (bez względu na wielkość liter) albo prawie te same współrzędne.
export function samePlace(a: Place, b: Place): boolean {
  if (a.countryCode !== b.countryCode) return false;
  if (lowerPl(a.name) === lowerPl(b.name)) return true;
  return Math.abs(a.latitude - b.latitude) < 0.05 && Math.abs(a.longitude - b.longitude) < 0.05;
}

// Fast: odpowiedź modelu → rekomendacja. Pierwsza linia „MIASTO: <nazwa>”, dalej uzasadnienie.
// Nazwa musi być jedną z nazw z geokodowania (bez względu na wielkość liter); zwracamy nazwę z geokodowania.
// Uzasadnienie: 2–3 zdania, ≤ 600 znaków, wymienia każde brakujące źródło. Inaczej null → „Rekomendacja niedostępna”.
export function parseRecommendation(text: string, nazwy: string[], karty: DashboardCard[]): CompareRecommendation | null {
  const lines = text.trim().split(/\r?\n/);
  const match = /^\s*MIASTO\s*:\s*(.+?)\s*\.?\s*$/i.exec(lines[0] ?? "");
  if (!match) return null;
  const wybrane = nazwy.find((n) => lowerPl(n) === lowerPl(match[1]));
  if (!wybrane) return null;
  const uzasadnienie = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
  const sentences = countSentences(uzasadnienie);
  if (
    uzasadnienie.length === 0 ||
    uzasadnienie.length > MAX_SUMMARY_CHARS ||
    sentences < MIN_SUMMARY_SENTENCES ||
    sentences > MAX_SUMMARY_SENTENCES ||
    !summaryNamesMissing(uzasadnienie, karty)
  ) {
    return null;
  }
  return { miasto: wybrane, uzasadnienie };
}

async function handleCompare(
  deps: DashboardDeps,
  miasta: [string, string],
  data: string,
  at: Date,
  log: (m: string) => void,
): Promise<Response> {
  // 1. Geokodowanie obu miast – każde dokładnie raz, równolegle.
  const steps = await Promise.all(miasta.map((m) => geocodeStep(m, deps.sources, at)));

  // 2. Miasto nie znalezione → 400 z nazwą miasta (komunikat narzędzia). Serwis niedostępny → dalej, karty „Brak danych”.
  const notFound = steps.flatMap((s) => (s.kind === "not_found" ? [s.komunikat] : []));
  if (notFound.length > 0) return json({ error: notFound.join(" ") }, 400);

  // 3. To samo miasto dwa razy – sprawdzane po geokodowaniu.
  const [s1, s2] = steps;
  if (s1.kind === "ok" && s2.kind === "ok" && samePlace(s1.place, s2.place)) {
    return json({ error: sameCityMessage(s1.place.name) }, 400);
  }

  // 4. Po 5 kart na miasto, oba miasta równolegle; każda karta niezależnie.
  const kartyObu = await Promise.all(steps.map((s, i) => cardsForStep(miasta[i], s, data, deps.sources, at)));
  const cities = steps.map((s, i) => ({
    miasto: s.kind === "ok" ? s.place.name : miasta[i],
    kraj: s.kind === "ok" ? s.place.country : "",
    karty: kartyObu[i],
  })) as [CompareCity, CompareCity];

  // 5. Rekomendacja agenta – tylko na podstawie kart. Przy problemie: „Rekomendacja niedostępna”, karty zostają.
  let rekomendacja: CompareRecommendation | null = null;
  if (deps.recommend) {
    try {
      const text = await deps.recommend({
        data,
        miasta: cities.map((c) => ({ miasto: c.miasto, kraj: c.kraj, karty: cardsForModel(c.karty), brakujaceZrodla: missingSources(c.karty) })),
      });
      rekomendacja = parseRecommendation(text, cities.map((c) => c.miasto), [...cities[0].karty, ...cities[1].karty]);
      if (!rekomendacja) log(`[Amber] /api/dashboard – rekomendacja odrzucona (długość ${text.trim().length}).`);
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[Amber] /api/dashboard – błąd rekomendacji: ${details.slice(0, 300)}`);
    }
  }

  const result: CompareResult = { tryb: "porownanie", data, miasta: cities, rekomendacja };
  return json(result);
}

export function createDashboardHandler(deps: DashboardDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));

  return async function handleDashboardRequest(req: Request): Promise<Response> {
    // 1. Najpierw sesja – bez niej 401, zanim cokolwiek zostanie pobrane.
    if (!(await deps.hasSession(req))) return json({ error: DASHBOARD_MESSAGES.unauthorized }, 401);

    // 2. Dane wejściowe.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: DASHBOARD_MESSAGES.badRequest }, 400);
    }
    if (!isObject(body) || !Object.keys(body).every((k) => k === "miasto" || k === "miasto2" || k === "data")) {
      return json({ error: DASHBOARD_MESSAGES.badRequest }, 400);
    }
    const miasto = typeof body.miasto === "string" ? body.miasto.trim() : "";
    if (!miasto || miasto.length > 100) return json({ error: DASHBOARD_MESSAGES.noCity }, 400);
    // Fast: pole „miasto2” włącza tryb „Porównaj” (bez niego – jedno miasto, jak dotąd).
    const compare = "miasto2" in body;
    const miasto2 = typeof body.miasto2 === "string" ? body.miasto2.trim() : "";
    if (compare && (!miasto2 || miasto2.length > 100)) return json({ error: DASHBOARD_MESSAGES.noCity2 }, 400);
    const data = typeof body.data === "string" ? body.data : "";
    if (!isRealDate(data)) return json({ error: DASHBOARD_MESSAGES.badDate }, 400);

    const at = now();
    if (compare) return handleCompare(deps, [miasto, miasto2], data, at, log);

    // 3. Geokodowanie miasta – dokładnie raz (wynik używają karty Pogoda, Waluty, Święta, Wikipedia i Czas).
    //    Nieznane miasto → 400 (jak w Minimum). Geokodowanie niedostępne → karty bez danych (oprócz Wikipedii), status 200.
    const step = await geocodeStep(miasto, deps.sources, at);
    if (step.kind === "not_found") return json({ error: step.komunikat }, 400);

    // 4. Pięć kart (istniejące funkcje narzędzi), każda niezależnie.
    const place = step.kind === "ok" ? step.place : null;
    const karty = await cardsForStep(miasto, step, data, deps.sources, at);
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
