// Lekcja 8, Warsztat 2: misje – lista misji w jednym miejscu, misja „Raport”, endpoint (najpierw 401), źródła tylko z wyszukiwania.
// Uruchamianie: node --experimental-strip-types scripts/test-amber-missions.mjs
import { readFileSync } from "node:fs";
import {
  MISSIONS, MISSION_MESSAGES, MAX_TOPIC_CHARS, NO_SOURCES_TEXT, RAPORT_INSTRUCTIONS,
  publicMissions, findMission, readMissionFields, collectSources, validateRaportOutput, buildRaport, stripUrls,
  createMissionHandler, parseCriteria, checkComparisonFields, normalizeCell, validateComparisonOutput, buildComparison,
  COMPARISON_INSTRUCTIONS, NO_DATA,
} from "../lib/amber-missions.ts";

let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log(`✅ ${name}`); } else { bad++; console.log(`❌ NIE: ${name} ${extra}`); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- lista misji
const raport = findMission("raport");
check("Lista misji: „Raport” i „Porównanie trzech firm”", MISSIONS.length === 2 && raport?.nazwa === "Raport" && findMission("porownanie")?.nazwa === "Porównanie trzech firm");
check("Każda misja ma nazwę, opis, pola, instrukcję", MISSIONS.every((m) => m.nazwa && m.opis && m.pola.length > 0 && m.instrukcja));
check("Przeglądarka dostaje misje bez instrukcji", publicMissions().every((m) => !("instrukcja" in m) && !("schema" in m)));
check("Raport: jedno pole „temat”, najwyżej 200 znaków", raport.pola.length === 1 && raport.pola[0].name === "temat" && raport.pola[0].maxLength === 200 && MAX_TOPIC_CHARS === 200);
check("Nieznana misja → brak", findMission("xyz") === undefined && findMission(5) === undefined);

// --- pola
check("Temat OK", readMissionFields(raport, { temat: "  Czujniki dymu  " }).ok && readMissionFields(raport, { temat: "  Czujniki dymu  " }).pola.temat === "Czujniki dymu");
check("Pusty temat → komunikat", !readMissionFields(raport, { temat: "   " }).ok);
check("Temat 201 znaków → komunikat", !readMissionFields(raport, { temat: "a".repeat(201) }).ok);
check("Temat 200 znaków → OK", readMissionFields(raport, { temat: "a".repeat(200) }).ok);
check("Temat nie-tekst → błąd", !readMissionFields(raport, { temat: 5 }).ok && !readMissionFields(raport, null).ok);

// --- walidator wyniku
const good = { podsumowanie: ["Zdanie 1.", "Zdanie 2.", "Zdanie 3."], informacje: ["a", "b", "c", "d"], wnioski: ["w1", "w2"] };
check("Poprawny wynik przechodzi", validateRaportOutput(good).success);
check("Podsumowanie ≠ 3 zdania → odrzucone", !validateRaportOutput({ ...good, podsumowanie: ["a", "b"] }).success);
check("Informacje: 3 → odrzucone, 7 → odrzucone", !validateRaportOutput({ ...good, informacje: ["a", "b", "c"] }).success && !validateRaportOutput({ ...good, informacje: Array(7).fill("x") }).success);
check("Wnioski: 1 → odrzucone, 4 → odrzucone", !validateRaportOutput({ ...good, wnioski: ["a"] }).success && !validateRaportOutput({ ...good, wnioski: ["a", "b", "c", "d"] }).success);
check("Adres strony w tekście modelu jest usuwany", stripUrls("Zobacz https://zmyslone.example/x i www.fake.com teraz") === "Zobacz i teraz");
const v = validateRaportOutput({ ...good, informacje: ["Fakt (https://wymyslony.pl/a)", "b", "c", "d"] });
check("Walidator usuwa linki z punktów", v.success && !v.value.informacje[0].includes("http"));

// --- źródła tylko z wyszukiwania
const srcs = collectSources([
  { sourceType: "url", url: "https://gov.uk/smoke", title: "GOV.UK" },
  { sourceType: "url", url: "https://gov.uk/smoke", title: "duplikat" },
  { sourceType: "url", url: "javascript:alert(1)", title: "zły" },
  { sourceType: "document", title: "dokument" },
  { sourceType: "url", url: "http://example.org/a" },
]);
check("Źródła: tylko http(s), bez powtórzeń, bez dokumentów", srcs.length === 2 && srcs[0].url === "https://gov.uk/smoke" && srcs[1].tytul === "example.org");
const rep = buildRaport(good, { temat: "T" }, srcs);
check("Raport: sekcje w kolejności Podsumowanie, Najważniejsze informacje, Wnioski, Źródła", rep.sekcje.map((s) => s.tytul).join("|") === "Podsumowanie|Najważniejsze informacje|Wnioski|Źródła");
check("Źródła = linki z wyszukiwania", rep.sekcje[3].typ === "linki" && rep.sekcje[3].linki.length === 2 && !rep.sekcje[3].brak);
const repEmpty = buildRaport(good, { temat: "T" }, []);
check("Brak wyników wyszukiwania → raport mówi to wprost", repEmpty.sekcje[3].brak === NO_SOURCES_TEXT && /nie zwróciło/.test(NO_SOURCES_TEXT));
check("Instrukcja: temat = dane, tylko z wyszukiwania, bez linków, wprost gdy brak", /DANE/.test(RAPORT_INSTRUCTIONS) && /WYŁĄCZNIE na podstawie/.test(RAPORT_INSTRUCTIONS) && /Nie wpisuj adresów/.test(RAPORT_INSTRUCTIONS) && /napisz to wprost/.test(RAPORT_INSTRUCTIONS));

// --- endpoint
const post = (body) => new Request("http://localhost/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let modelCalls = 0, runCalls = 0, lastTools = null, lastStep = 0;
const deps = (extra = {}) => ({
  getSession: () => ({ userId: "u1" }),
  stepLimit: 6,
  createModel: () => { modelCalls++; return { fake: true }; },
  createSearchTool: () => ({ type: "provider", id: "openrouter.web_search" }),
  run: async ({ tools, stepLimit }) => { runCalls++; lastTools = tools; lastStep = stepLimit; return { ok: true, raport: rep }; },
  log: () => {},
  ...extra,
});
{
  modelCalls = 0; runCalls = 0;
  const res = await createMissionHandler(deps({ getSession: () => null }))(post({ misja: "raport", pola: { temat: "x" } }));
  check("Bez zalogowania → 401, zanim wywoła model", res.status === 401 && modelCalls === 0 && runCalls === 0 && (await res.json()).komunikat === MISSION_MESSAGES.unauthorized);
}
{
  const res = await createMissionHandler(deps())(post({ misja: "nie-ma", pola: {} }));
  check("Nieznana misja → 400", res.status === 400);
}
{
  modelCalls = 0;
  const res = await createMissionHandler(deps())(post({ misja: "raport", pola: { temat: "a".repeat(201) } }));
  check("Za długi temat → 400 bez modelu", res.status === 400 && modelCalls === 0);
}
{
  const res = await createMissionHandler(deps())(new Request("http://localhost/api/missions", { method: "POST", body: "{zly" }));
  check("Zły JSON → 400", res.status === 400);
}
{
  const res = await createMissionHandler(deps())(post({ misja: "raport", pola: { temat: "Czujniki dymu" } }));
  const data = await res.json();
  check("Misja OK → raport, agent dostał wyszukiwanie", res.status === 200 && data.raport.sekcje.length === 4 && lastTools && "web_search" in lastTools && lastStep === 6);
}
{
  const res = await createMissionHandler(deps({ createModel: () => null }))(post({ misja: "raport", pola: { temat: "x" } }));
  check("Brak modelu → 500 z komunikatem", res.status === 500 && (await res.json()).komunikat === MISSION_MESSAGES.config);
}
{
  const res = await createMissionHandler(deps({ run: async () => ({ ok: false, kind: "provider_error", details: "x" }) }))(post({ misja: "raport", pola: { temat: "x" } }));
  check("Błąd dostawcy → czytelny komunikat po polsku", res.status === 502 && (await res.json()).komunikat === MISSION_MESSAGES.provider_error);
}
{
  const res = await createMissionHandler(deps({ run: async () => ({ ok: false, kind: "step_limit", details: "x" }) }))(post({ misja: "raport", pola: { temat: "x" } }));
  check("Limit kroków → komunikat", /limicie kroków/.test((await res.json()).komunikat));
}
{
  let aborted = false;
  const res = await createMissionHandler(deps({
    timeoutMs: 30,
    run: ({ abortSignal }) => new Promise((resolve) => abortSignal.addEventListener("abort", () => { aborted = true; resolve({ ok: false, kind: "timeout", details: "abort" }); })),
  }))(post({ misja: "raport", pola: { temat: "x" } }));
  check("Za długo → przerwanie i 504 z komunikatem", aborted && res.status === 504 && /minutę/.test((await res.json()).komunikat));
}

// --- Porównanie trzech firm
const cmp = findMission("porownanie");
check("Porównanie: pola Firma 1–3 i Kryteria", cmp.pola.map((f) => f.name).join() === "firma1,firma2,firma3,kryteria");
const P = { firma1: "Ajax", firma2: "Texecom", firma3: "Pyronix", kryteria: "cena, aplikacja mobilna ,  gwarancja" };
check("Kryteria po przecinku", parseCriteria(P.kryteria).join("|") === "cena|aplikacja mobilna|gwarancja");
check("2–5 kryteriów OK", readMissionFields(cmp, P).ok && readMissionFields(cmp, { ...P, kryteria: "a, b" }).ok && readMissionFields(cmp, { ...P, kryteria: "a,b,c,d,e" }).ok);
check("1 kryterium → komunikat", !readMissionFields(cmp, { ...P, kryteria: "cena" }).ok && /od 2 do 5/.test(readMissionFields(cmp, { ...P, kryteria: "cena" }).komunikat));
check("6 kryteriów → komunikat", !readMissionFields(cmp, { ...P, kryteria: "a,b,c,d,e,f" }).ok);
check("Powtórzone kryteria / te same firmy → komunikat", checkComparisonFields({ ...P, kryteria: "cena, Cena" }) !== null && checkComparisonFields({ ...P, firma2: "ajax" }) !== null);
check("Brak firmy → komunikat", !readMissionFields(cmp, { ...P, firma3: " " }).ok);
check("Komórka pusta / „0” / „-” → „brak danych”", normalizeCell("") === NO_DATA && normalizeCell("0") === NO_DATA && normalizeCell("-") === NO_DATA && normalizeCell("od £200") === "od £200");
const out = { wiersze: [
  { kryterium: "cena", wartosci: ["od £200", "0", "brak danych"] },
  { kryterium: "aplikacja mobilna", wartosci: ["tak", "tak", "tak"] },
  { kryterium: "gwarancja", wartosci: ["2 lata", "", "5 lat"] },
], rekomendacja: { firma: "ajax", uzasadnienie: "Najlepsza aplikacja (https://x.example)." } };
const vc = validateComparisonOutput(out, P);
check("Poprawny wynik porównania przechodzi", vc.success);
check("Zero i puste → „brak danych”, linki usunięte, nazwa firmy z formularza", vc.success && vc.value.wiersze[0].wartosci[1] === NO_DATA && vc.value.wiersze[2].wartosci[1] === NO_DATA && vc.value.rekomendacja.firma === "Ajax" && !vc.value.rekomendacja.uzasadnienie.includes("http"));
check("Brakujący wiersz → odrzucone", !validateComparisonOutput({ ...out, wiersze: out.wiersze.slice(0, 2) }, P).success);
check("Inne kryterium niż wpisane → odrzucone", !validateComparisonOutput({ ...out, wiersze: [{ ...out.wiersze[0], kryterium: "jakość" }, ...out.wiersze.slice(1)] }, P).success);
check("Firma bez oceny (2 wartości) → odrzucone", !validateComparisonOutput({ ...out, wiersze: [{ kryterium: "cena", wartosci: ["a", "b"] }, ...out.wiersze.slice(1)] }, P).success);
check("Rekomendacja spoza trzech firm → odrzucona", !validateComparisonOutput({ ...out, rekomendacja: { firma: "Bosch", uzasadnienie: "x" } }, P).success);
const cr = buildComparison(vc.value, P, srcs);
check("Tabela z pól: firmy w kolumnach, kryteria w wierszach", cr.sekcje[0].typ === "tabela" && cr.sekcje[0].kolumny.join() === "Ajax,Texecom,Pyronix" && cr.sekcje[0].wiersze.map((w) => w.kryterium).join() === "cena,aplikacja mobilna,gwarancja");
check("Pod tabelą: rekomendacja, potem źródła z wyszukiwania", cr.sekcje[1].tytul === "Rekomendacja" && cr.sekcje[1].tekst.startsWith("Ajax – ") && cr.sekcje[2].typ === "linki" && cr.sekcje[2].linki.length === 2);
check("Instrukcja: dane, każda firma osobno, „brak danych”, bez zera, bez linków", /DANE/.test(COMPARISON_INSTRUCTIONS) && /KAŻDEJ z trzech firm/.test(COMPARISON_INSTRUCTIONS) && /„brak danych”/.test(COMPARISON_INSTRUCTIONS) && /nie wpisuj zera/.test(COMPARISON_INSTRUCTIONS) && /Nie wpisuj adresów/.test(COMPARISON_INSTRUCTIONS));
check("Prompt: firmy i kryteria w znacznikach", /<firmy>[\s\S]*Texecom[\s\S]*<\/firmy>/.test(cmp.prompt(P)) && /<kryteria>[\s\S]*gwarancja/.test(cmp.prompt(P)));
{
  modelCalls = 0;
  const res = await createMissionHandler(deps())(post({ misja: "porownanie", pola: { ...P, kryteria: "cena" } }));
  check("Endpoint: złe kryteria → 400 bez modelu", res.status === 400 && modelCalls === 0);
}

// --- pliki
const lib = read("lib/amber-missions.ts");
check("Misje: limit kroków jak w czacie (AGENT_STEP_LIMIT), 60 s", /isStepCount\(stepLimit\)/.test(lib) && /stepLimit: AGENT_STEP_LIMIT/.test(read("app/api/missions/route.ts")) && /MISSION_TIMEOUT_MS = 60_000/.test(lib));
check("Misje: bez bazy i bez wysyłania", !/supabase|from\(|insert|fetch\(/i.test(lib));
const model = read("lib/model.ts");
check("lib/model.ts: webSearchTool z ustawieniami czatu", /export function webSearchTool/.test(model) && /maxResults: 3, engine: "native"/.test(model));
check("Czat korzysta z tego samego wyszukiwania", /web_search: createWebSearchTool\(openrouter\)/.test(read("app/api/agent/route.ts")));
const route = read("app/api/missions/route.ts");
check("Endpoint: sesja, model, wyszukiwanie", /getApiSession/.test(route) && /webSearchTool\(\)/.test(route) && /force-dynamic/.test(route));
const page = read("app/misje/page.tsx");
check("Strona /misje tylko dla zalogowanych", /getCurrentUser/.test(page) && /redirect\(loginUrl\("\/misje"\)\)/.test(page) && /force-dynamic/.test(page));
const form = read("app/misje/missions-form.tsx");
check("Formularz: „Uruchom misję”, „Agent pracuje…”, blokada, komunikat błędu", /Uruchom misję/.test(form) && /Agent pracuje…/.test(form) && /disabled=\{pending/.test(form) && /setError/.test(form) && /finally/.test(form));
check("Formularz: tabela i wyszarzone „brak danych”", /mission-table/.test(form) && /no-data/.test(form));
check("Formularz: klikalne linki w nowej karcie", /target="_blank" rel="noopener noreferrer"/.test(form));
check("Link „Misje” w nawigacji", /href="\/misje"[^>]*>\s*Misje/.test(read("app/chat.tsx")));

console.log(`\nWynik: ${ok} zaliczonych, ${bad} niezaliczonych.`);
if (bad) process.exitCode = 1;
