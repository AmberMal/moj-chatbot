// Lekcja 4: narzędzia lokalne agenta (bez internetu): kalkulator, czas, notatki, diagnostyka.
// Działają tylko na serwerze. Żadne nie wykonuje kodu wpisanego przez użytkownika ani nie zwraca sekretów.

import { jsonSchema, tool, type ToolSet } from "ai";

// Godzina pobrania / obliczenia – czas Londynu (np. „12.11.2026, 18:30:05”).
export function fetchedAtLabel(date: Date = new Date()): string {
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

type Check<T> = { success: true; value: T } | { success: false; error: Error };
const ok = <T>(value: T): Check<T> => ({ success: true, value });
const bad = <T>(message: string): Check<T> => ({ success: false, error: new Error(message) });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));

// ---------------------------------------------------------------------------
// kalkulator – działanie + liczby jako osobne argumenty (bez eval, bez wpisanego kodu)
// ---------------------------------------------------------------------------
export const CALC_OPERATIONS = ["dodaj", "odejmij", "pomnoz", "podziel", "potega", "pierwiastek", "procent"] as const;
type CalcOp = (typeof CALC_OPERATIONS)[number];
export type CalcInput = { dzialanie: CalcOp; liczby: number[] };
export type CalcResult =
  | { ok: true; dzialanie: CalcOp; liczby: number[]; wynik: number; obliczono: string }
  | { ok: false; komunikat: string; obliczono: string };

export function calculate({ dzialanie, liczby }: CalcInput, now = new Date()): CalcResult {
  const obliczono = fetchedAtLabel(now);
  const fail = (komunikat: string): CalcResult => ({ ok: false, komunikat, obliczono });
  const need = (n: number) => liczby.length === n;
  let wynik: number;
  switch (dzialanie) {
    case "dodaj":
      if (liczby.length < 2) return fail("Dodawanie wymaga co najmniej dwóch liczb.");
      wynik = liczby.reduce((a, b) => a + b, 0);
      break;
    case "odejmij":
      if (liczby.length < 2) return fail("Odejmowanie wymaga co najmniej dwóch liczb.");
      wynik = liczby.slice(1).reduce((a, b) => a - b, liczby[0]);
      break;
    case "pomnoz":
      if (liczby.length < 2) return fail("Mnożenie wymaga co najmniej dwóch liczb.");
      wynik = liczby.reduce((a, b) => a * b, 1);
      break;
    case "podziel":
      if (!need(2)) return fail("Dzielenie wymaga dokładnie dwóch liczb: dzielnej i dzielnika.");
      if (liczby[1] === 0) return fail("Nie można dzielić przez zero.");
      wynik = liczby[0] / liczby[1];
      break;
    case "potega":
      if (!need(2)) return fail("Potęgowanie wymaga dwóch liczb: podstawy i wykładnika.");
      wynik = liczby[0] ** liczby[1];
      break;
    case "pierwiastek":
      if (!need(1)) return fail("Pierwiastek wymaga dokładnie jednej liczby.");
      if (liczby[0] < 0) return fail("Nie można obliczyć pierwiastka kwadratowego z liczby ujemnej.");
      wynik = Math.sqrt(liczby[0]);
      break;
    case "procent":
      if (!need(2)) return fail("Procent wymaga dwóch liczb: ile procent i z jakiej liczby (np. 23 i 666).");
      wynik = (liczby[0] / 100) * liczby[1];
      break;
  }
  if (!Number.isFinite(wynik)) return fail("Wynik jest zbyt duży, żeby go podać.");
  return { ok: true, dzialanie, liczby, wynik: Math.round(wynik * 1e10) / 1e10, obliczono };
}

export const kalkulator = tool({
  description:
    "Wykonuje dokładne obliczenie na liczbach podanych jako osobne argumenty. Użyj zawsze, gdy klient prosi o policzenie " +
    "sumy, różnicy, iloczynu, ilorazu, potęgi, pierwiastka lub procentu (np. VAT 20% od 666). Nie licz w pamięci. " +
    "Działania: dodaj, odejmij, pomnoz, podziel (2 liczby), potega (podstawa, wykładnik), pierwiastek (1 liczba), procent (ile %, z jakiej liczby).",
  inputSchema: jsonSchema<CalcInput>(
    {
      type: "object",
      properties: {
        dzialanie: { type: "string", enum: [...CALC_OPERATIONS] },
        liczby: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 20 },
      },
      required: ["dzialanie", "liczby"],
      additionalProperties: false,
    },
    {
      validate: (v) => {
        if (!isObject(v) || !onlyKeys(v, ["dzialanie", "liczby"])) return bad("Nieprawidłowe dane kalkulatora.");
        const { dzialanie, liczby } = v;
        if (typeof dzialanie !== "string" || !(CALC_OPERATIONS as readonly string[]).includes(dzialanie)) {
          return bad(`Nieznane działanie. Dozwolone: ${CALC_OPERATIONS.join(", ")}.`);
        }
        if (!Array.isArray(liczby) || liczby.length < 1 || liczby.length > 20) return bad("Podaj od 1 do 20 liczb.");
        if (!liczby.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e15)) {
          return bad("Wszystkie argumenty muszą być liczbami (do 10^15).");
        }
        return ok({ dzialanie: dzialanie as CalcOp, liczby: liczby as number[] });
      },
    },
  ),
  execute: async (input) => calculate(input),
});

// ---------------------------------------------------------------------------
// czas – aktualna data i godzina w podanej strefie (domyślnie Europe/London)
// ---------------------------------------------------------------------------
export const DEFAULT_TIME_ZONE = "Europe/London";
export type TimeResult =
  | { ok: true; strefa: string; data: string; dzienTygodnia: string; godzina: string; pobrano: string }
  | { ok: false; komunikat: string; pobrano: string };

export function timeIn(strefa: string = DEFAULT_TIME_ZONE, now = new Date()): TimeResult {
  const pobrano = fetchedAtLabel(now);
  try {
    const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pl-PL", { timeZone: strefa, ...o }).format(now);
    return {
      ok: true,
      strefa,
      data: part({ day: "2-digit", month: "2-digit", year: "numeric" }),
      dzienTygodnia: part({ weekday: "long" }),
      godzina: part({ hour: "2-digit", minute: "2-digit", hour12: false }),
      pobrano,
    };
  } catch {
    return { ok: false, komunikat: `Nie znam strefy czasowej „${strefa}”. Podaj ją w formacie np. Europe/Warsaw albo America/New_York.`, pobrano };
  }
}

export const czas = tool({
  description:
    "Zwraca aktualną datę, dzień tygodnia i godzinę w podanej strefie czasowej (IANA, np. Europe/Warsaw, America/New_York). " +
    "Domyślnie Europe/London (czas firmy). Użyj zawsze, gdy pytanie dotyczy dzisiejszej daty, jutra, dnia tygodnia, " +
    "aktualnej godziny (także w innym kraju) albo tego, za ile dni coś nastąpi – nie zgaduj daty z pamięci.",
  inputSchema: jsonSchema<{ strefa?: string }>(
    {
      type: "object",
      properties: { strefa: { type: "string", description: "Strefa czasowa IANA, np. Europe/Warsaw" } },
      additionalProperties: false,
    },
    {
      validate: (v) => {
        if (!isObject(v) || !onlyKeys(v, ["strefa"])) return bad("Nieprawidłowe dane narzędzia czas.");
        if (v.strefa === undefined) return ok({});
        if (typeof v.strefa !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(v.strefa) || v.strefa.length > 50) {
          return bad("Podaj strefę czasową w formacie np. Europe/Warsaw.");
        }
        return ok({ strefa: v.strefa });
      },
    },
  ),
  execute: async ({ strefa }) => timeIn(strefa ?? DEFAULT_TIME_ZONE),
});

// ---------------------------------------------------------------------------
// notatki – osobne dla każdej sesji, TYLKO w pamięci serwera (tymczasowe)
// ---------------------------------------------------------------------------
export const MAX_NOTES = 50;
export const MAX_NOTE_CHARS = 500;
const MAX_SESSIONS = 500;
export type Note = { nr: number; tresc: string; zapisano: string };
export type NotesStore = Map<string, Note[]>;
export const NOTES_TEMPORARY_INFO =
  "Notatki są tymczasowe – trzymane w pamięci serwera i mogą zniknąć w każdej chwili (np. po restarcie).";

// Wspólny magazyn procesu serwera (klucz = identyfikator sesji).
const globalStore: NotesStore = new Map();

export type NotesResult =
  | { ok: true; akcja: "zapisz"; zapisano: Note; liczbaNotatek: number; uwaga: string; pobrano: string }
  | { ok: true; akcja: "pokaz"; notatki: Note[]; uwaga: string; pobrano: string }
  | { ok: false; komunikat: string; pobrano: string };

export function runNotes(
  store: NotesStore,
  sessionKey: string,
  input: { akcja: "zapisz" | "pokaz"; tresc?: string },
  now = new Date(),
): NotesResult {
  const pobrano = fetchedAtLabel(now);
  const list = store.get(sessionKey) ?? [];
  if (input.akcja === "pokaz") {
    return { ok: true, akcja: "pokaz", notatki: list.slice(), uwaga: NOTES_TEMPORARY_INFO, pobrano };
  }
  const tresc = (input.tresc ?? "").trim();
  if (!tresc) return { ok: false, komunikat: "Podaj treść notatki do zapisania.", pobrano };
  if (list.length >= MAX_NOTES) {
    return { ok: false, komunikat: `Osiągnięto limit ${MAX_NOTES} notatek w tej sesji.`, pobrano };
  }
  if (!store.has(sessionKey) && store.size >= MAX_SESSIONS) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  const note: Note = { nr: list.length + 1, tresc, zapisano: pobrano };
  store.set(sessionKey, [...list, note]);
  return { ok: true, akcja: "zapisz", zapisano: note, liczbaNotatek: list.length + 1, uwaga: NOTES_TEMPORARY_INFO, pobrano };
}

export function createNotesTool(sessionKey: string, store: NotesStore = globalStore) {
  return tool({
    description:
      "Zapisuje krótką notatkę klienta (akcja: zapisz, treść do 500 znaków) albo pokazuje notatki zapisane w tej sesji (akcja: pokaz). " +
      "Użyj, gdy klient wyraźnie prosi o zapisanie lub pokazanie notatek. Notatki są TYMCZASOWE (pamięć serwera) – " +
      "zawsze uprzedź klienta, że mogą zniknąć, i nie przedstawiaj ich jako trwałej pamięci.",
    inputSchema: jsonSchema<{ akcja: "zapisz" | "pokaz"; tresc?: string }>(
      {
        type: "object",
        properties: {
          akcja: { type: "string", enum: ["zapisz", "pokaz"] },
          tresc: { type: "string", maxLength: MAX_NOTE_CHARS },
        },
        required: ["akcja"],
        additionalProperties: false,
      },
      {
        validate: (v) => {
          if (!isObject(v) || !onlyKeys(v, ["akcja", "tresc"])) return bad("Nieprawidłowe dane notatek.");
          if (v.akcja !== "zapisz" && v.akcja !== "pokaz") return bad("Akcja musi być: zapisz albo pokaz.");
          if (v.tresc !== undefined && (typeof v.tresc !== "string" || v.tresc.length > MAX_NOTE_CHARS)) {
            return bad(`Notatka może mieć najwyżej ${MAX_NOTE_CHARS} znaków.`);
          }
          return ok({ akcja: v.akcja, ...(typeof v.tresc === "string" ? { tresc: v.tresc } : {}) });
        },
      },
    ),
    execute: async (input) => runNotes(store, sessionKey, input),
  });
}

// ---------------------------------------------------------------------------
// diagnostyka – TYLKO przy `npm run dev` (dodawana w app/api/agent/route.ts). W produkcji jej nie ma.
// Zwraca wyłącznie „konfiguracja kompletna: tak/nie” (oraz godzinę sprawdzenia) –
// bez modelu, listy narzędzi, limitu kroków, nazw zmiennych środowiskowych, kluczy, haseł i wartości.
// ---------------------------------------------------------------------------
// Lekcja 7: logowanie przez Supabase Auth (zamiast CHAT_PASSWORD i SESSION_SECRET).
const REQUIRED_ENV_VARS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;
export type DiagnosticsResult = { konfiguracjaKompletna: "tak" | "nie"; pobrano: string };

export function diagnostics({ env }: { env: Record<string, string | undefined> }, now = new Date()): DiagnosticsResult {
  const complete = REQUIRED_ENV_VARS.every((name) => typeof env[name] === "string" && env[name]!.length > 0);
  return { konfiguracjaKompletna: complete ? "tak" : "nie", pobrano: fetchedAtLabel(now) };
}

export function createDiagnosticsTool(options: Parameters<typeof diagnostics>[0]) {
  return tool({
    description:
      "Diagnostyka czatu (tylko środowisko testowe): informacja, czy konfiguracja jest kompletna (tak/nie). " +
      "Użyj tylko na wyraźną prośbę o diagnostykę.",
    inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
    execute: async () => diagnostics(options),
  });
}

export type LocalToolSet = ToolSet;
