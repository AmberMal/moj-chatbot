// Lekcja 3: narzędzia dla modelu (function calling) – działają tylko na serwerze.
// aktualnyCzas: zwykła funkcja napisana przez nas. Tylko odczyt zegara serwera,
// bez danych wejściowych, bez dostępu do sekretów i bez żadnych operacji.

import { jsonSchema, tool } from "ai";

// Firma i klienci są w Londynie – czas Londynu (z automatyczną zmianą czasu letniego).
export const AMBER_TIME_ZONE = "Europe/London";

export type CurrentTimeInfo = {
  data: string; // np. „10.11.2026”
  dzienTygodnia: string; // np. „wtorek”
  godzina: string; // np. „18:50”
  strefa: string; // „Europe/London”
};

export function currentTimeInfo(now: Date = new Date()): CurrentTimeInfo {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pl-PL", { timeZone: AMBER_TIME_ZONE, ...options }).format(now);
  return {
    data: part({ day: "2-digit", month: "2-digit", year: "numeric" }),
    dzienTygodnia: part({ weekday: "long" }),
    godzina: part({ hour: "2-digit", minute: "2-digit", hour12: false }),
    strefa: AMBER_TIME_ZONE,
  };
}

export const aktualnyCzas = tool({
  description:
    "Zwraca dzisiejszą datę, dzień tygodnia i aktualną godzinę w Londynie (Europe/London). " +
    "Użyj zawsze, gdy pytanie dotyczy dzisiejszej daty, jutra, wczoraj, dnia tygodnia, aktualnej godziny " +
    "albo tego, za ile dni lub ile czasu temu coś było – nie zgaduj daty z pamięci.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  execute: async () => currentTimeInfo(),
});

// ---------------------------------------------------------------------------
// sprawdzObszar – wstępne sprawdzenie kodu pocztowego (dane potwierdzone przez firmę).
// Ostateczne potwierdzenie obszaru należy zawsze do zespołu.
// ---------------------------------------------------------------------------

// Londyn i okolice w obrębie M25.
export const AREA_INSIDE = [
  "E", "EC", "N", "NW", "SE", "SW", "W", "WC",
  "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD",
] as const;
// Obszary na granicy M25 – wymagają potwierdzenia przez zespół.
export const AREA_BORDER = ["AL", "CM", "GU", "HP", "RH", "SL", "SS", "TN"] as const;

export type AreaCheck = {
  kodPocztowy: string;
  obszarKodu: string | null;
  wynik: "w_obszarze" | "do_potwierdzenia" | "poza_obszarem" | "nieprawidlowy_kod";
  komunikat: string;
};

// Pełny kod (np. „SW19 1AA”) albo sama pierwsza część (np. „SW19”).
const POSTCODE_FULL = /^([A-Z]{1,2})\d[A-Z\d]?\d[A-Z]{2}$/;
const POSTCODE_OUTWARD = /^([A-Z]{1,2})\d[A-Z\d]?$/;

export function checkArea(input: string): AreaCheck {
  const normalized = String(input ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 10);
  const match = POSTCODE_FULL.exec(normalized) ?? POSTCODE_OUTWARD.exec(normalized);
  if (!match) {
    return {
      kodPocztowy: normalized,
      obszarKodu: null,
      wynik: "nieprawidlowy_kod",
      komunikat: "To nie wygląda na poprawny brytyjski kod pocztowy – poproś klienta o poprawny kod (np. SW19 1AA).",
    };
  }
  const area = match[1];
  if ((AREA_INSIDE as readonly string[]).includes(area)) {
    return { kodPocztowy: normalized, obszarKodu: area, wynik: "w_obszarze",
      komunikat: "Kod jest w obszarze działania firmy (Londyn i okolice M25). Ostatecznie potwierdza to zespół." };
  }
  if ((AREA_BORDER as readonly string[]).includes(area)) {
    return { kodPocztowy: normalized, obszarKodu: area, wynik: "do_potwierdzenia",
      komunikat: "Kod jest blisko granicy obszaru działania (M25) – zespół firmy potwierdzi, czy obsługujemy tę lokalizację." };
  }
  return { kodPocztowy: normalized, obszarKodu: area, wynik: "poza_obszarem",
    komunikat: "Kod jest prawdopodobnie poza obszarem działania firmy (Londyn i M25) – zespół może to potwierdzić." };
}

export const sprawdzObszar = tool({
  description:
    "Wstępnie sprawdza, czy brytyjski kod pocztowy klienta (np. SW19 1AA albo SW19) leży w obszarze działania firmy " +
    "(Londyn i okolice M25). Użyj, gdy klient poda kod pocztowy lub zapyta, czy obsługujemy jego okolicę. " +
    "Wynik jest tylko wstępny – ostatecznie obszar potwierdza zespół.",
  inputSchema: jsonSchema<{ kodPocztowy: string }>({
    type: "object",
    properties: { kodPocztowy: { type: "string", description: "Kod pocztowy podany przez klienta" } },
    required: ["kodPocztowy"],
    additionalProperties: false,
  }),
  execute: async ({ kodPocztowy }) => checkArea(kodPocztowy),
});

// ---------------------------------------------------------------------------
// informacjeOUrzadzeniu – czy obsługujemy markę systemu (dane potwierdzone przez firmę).
// ---------------------------------------------------------------------------

export const SUPPORTED_BRANDS = ["Ajax", "Texecom", "Pyronix"] as const;

export type DeviceInfo = {
  producent: string;
  obslugiwanaMarka: string | null;
  komunikat: string;
};

export function deviceInfo(input: string): DeviceInfo {
  const producent = String(input ?? "").trim().slice(0, 60);
  const lower = producent.toLowerCase();
  const brand = SUPPORTED_BRANDS.find((name) => lower.includes(name.toLowerCase())) ?? null;
  if (brand) {
    return { producent, obslugiwanaMarka: brand,
      komunikat: `Instalujemy i serwisujemy systemy marki ${brand}. Przy usterce poproś o model urządzenia i dokładny komunikat błędu.` };
  }
  return { producent, obslugiwanaMarka: null,
    komunikat: "Firma może serwisować większość istniejących systemów, także starszych – zależy to od producenta, modelu i stanu urządzenia. " +
      "Poproś o model urządzenia lub zdjęcie na WhatsApp: 123 456 78900." };
}

export const informacjeOUrzadzeniu = tool({
  description:
    "Sprawdza, czy firma obsługuje markę systemu alarmowego klienta (np. Ajax, Texecom, Pyronix albo inna). " +
    "Użyj, gdy klient poda producenta lub model swojego alarmu albo zapyta, czy serwisujemy jego system. " +
    "Nie zwraca cen ani porad technicznych.",
  inputSchema: jsonSchema<{ producent: string }>({
    type: "object",
    properties: { producent: { type: "string", description: "Producent lub model podany przez klienta" } },
    required: ["producent"],
    additionalProperties: false,
  }),
  execute: async ({ producent }) => deviceInfo(producent),
});

// Nazwy narzędzi pokazywane w czacie (etykiety). „wyszukiwanie” = web search OpenRouter.
export const KNOWN_TOOL_NAMES = ["wyszukiwanie", "aktualnyCzas", "sprawdzObszar", "informacjeOUrzadzeniu"] as const;
export type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];
