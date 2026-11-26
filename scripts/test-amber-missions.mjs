// Lekcja 8, Warsztat 2: misje – lista misji w jednym miejscu, misja „Raport”, endpoint (najpierw 401), źródła tylko z wyszukiwania.
// Uruchamianie: node --experimental-strip-types scripts/test-amber-missions.mjs
import { readFileSync } from "node:fs";
import {
  MISSIONS, MISSION_MESSAGES, MAX_TOPIC_CHARS, NO_SOURCES_TEXT, RAPORT_INSTRUCTIONS,
  publicMissions, findMission, readMissionFields, collectSources, validateRaportOutput, buildRaport, stripUrls,
  createMissionHandler, RAPORT_RESEARCH_INSTRUCTIONS, NO_BASIS_TEXT, parseCriteria, checkComparisonFields, normalizeCell, validateComparisonOutput, buildComparison,
  COMPARISON_INSTRUCTIONS, COMPARISON_RESEARCH_INSTRUCTIONS, NO_DATA,
  VISIT_INSTRUCTIONS, VISIT_SIGNATURE, NO_KB_SOURCES_TEXT, validateVisitOutput, buildVisit,
} from "../lib/amber-missions.ts";
import { reportToText } from "../lib/amber-mission-text.ts";

let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log(`✅ ${name}`); } else { bad++; console.log(`❌ NIE: ${name} ${extra}`); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- lista misji
const raport = findMission("raport");
check("Lista misji: Raport, Porównanie trzech firm, Notatka z wizyty", MISSIONS.length === 3 && raport?.nazwa === "Raport" && findMission("porownanie")?.nazwa === "Porównanie trzech firm" && findMission("wizyta")?.nazwa === "Notatka z wizyty");
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

// --- walidator wyniku (Standard: Fakty z numerami źródeł, Czego nie udało się ustalić)
const srcs = collectSources([
  { sourceType: "url", url: "https://gov.uk/smoke", title: "GOV.UK" },
  { sourceType: "url", url: "https://gov.uk/smoke", title: "duplikat" },
  { sourceType: "url", url: "javascript:alert(1)", title: "zły" },
  { sourceType: "document", title: "dokument" },
  { sourceType: "url", url: "http://example.org/a" },
]);
check("Źródła: tylko http(s), bez powtórzeń, bez dokumentów", srcs.length === 2 && srcs[0].url === "https://gov.uk/smoke" && srcs[1].tytul === "example.org");
const facts = [{ tekst: "F1.", zrodlo: 1 }, { tekst: "F2.", zrodlo: 2 }, { tekst: "F3.", zrodlo: 1 }, { tekst: "F4.", zrodlo: 2 }];
const good = { podsumowanie: ["Zdanie 1.", "Zdanie 2.", "Zdanie 3."], fakty: facts, nieustalone: ["Brak danych o cenach."], wnioski: ["w1", "w2"] };
const V = (o, s2 = srcs) => validateRaportOutput(o, { temat: "T" }, s2);
check("Poprawny wynik przechodzi", V(good).success);
check("Podsumowanie ≠ 3 zdania → odrzucone", !V({ ...good, podsumowanie: ["a", "b"] }).success);
check("Fakty: 3 → odrzucone, 7 → odrzucone", !V({ ...good, fakty: facts.slice(0, 3) }).success && !V({ ...good, fakty: [...facts, ...facts.slice(0, 3)] }).success);
check("Fakt z numerem spoza listy źródeł → odrzucony", !V({ ...good, fakty: [...facts.slice(0, 3), { tekst: "X", zrodlo: 3 }] }).success && !V({ ...good, fakty: [...facts.slice(0, 3), { tekst: "X", zrodlo: 0 }] }).success);
check("Bez źródeł: fakty puste OK, z faktami → odrzucone", V({ ...good, fakty: [] }, []).success && !V(good, []).success);
check("Czego nie udało się ustalić: 1–3", !V({ ...good, nieustalone: [] }).success && !V({ ...good, nieustalone: ["a", "b", "c", "d"] }).success);
check("Wnioski: 1 → odrzucone, 4 → odrzucone", !V({ ...good, wnioski: ["a"] }).success && !V({ ...good, wnioski: ["a", "b", "c", "d"] }).success);
check("Adres strony w tekście modelu jest usuwany", stripUrls("Zobacz https://zmyslone.example/x i www.fake.com teraz") === "Zobacz i teraz");
const v = V({ ...good, fakty: [{ tekst: "Fakt (https://wymyslony.pl/a) [7]", zrodlo: 1 }, ...facts.slice(1)] });
check("Walidator usuwa linki i numery dopisane przez model", v.success && v.value.fakty[0].tekst === "Fakt");
const rep = buildRaport(v.value, { temat: "T" }, srcs);
check("Raport: Podsumowanie, Fakty, Czego nie udało się ustalić, Wnioski, Źródła", rep.sekcje.map((s) => s.tytul).join("|") === "Podsumowanie|Fakty|Czego nie udało się ustalić|Wnioski|Źródła");
check("Każdy fakt kończy się numerem źródła [n]", rep.sekcje[1].typ === "lista" && rep.sekcje[1].punkty.every((p) => /\[\d+\]$/.test(p)) && rep.sekcje[1].punkty[1] === "F2. [2]");
check("Źródła ponumerowane = linki z wyszukiwania", rep.sekcje[4].typ === "linki" && rep.sekcje[4].numerowane === true && rep.sekcje[4].linki.length === 2 && !rep.sekcje[4].brak);
const repEmpty = buildRaport(V({ ...good, fakty: [] }, []).value, { temat: "T" }, []);
check("Brak wyników wyszukiwania → raport mówi to wprost", repEmpty.sekcje[4].brak === NO_SOURCES_TEXT && /nie zwróciło/.test(NO_SOURCES_TEXT) && repEmpty.sekcje[1].typ === "tekst");
check("Instrukcja: dane, tylko z notatek, numery z listy, wnioski = interpretacje", /DANE/.test(RAPORT_INSTRUCTIONS) && /WYŁĄCZNIE na podstawie notatek/.test(RAPORT_INSTRUCTIONS) && /tylko numerów z tej listy/.test(RAPORT_INSTRUCTIONS) && /wyłącznie Twoje interpretacje/.test(RAPORT_INSTRUCTIONS));
check("Raport w dwóch krokach: zbieranie z wyszukiwaniem, potem pola", !!raport.zbieranie && /adres strony/.test(RAPORT_RESEARCH_INSTRUCTIONS) && /\[1\] GOV\.UK – https:\/\/gov\.uk\/smoke/.test(raport.prompt({ temat: "T" }, { notatki: "n", zrodla: srcs })));

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
  const res = await createMissionHandler(deps({ now: () => new Date("2026-11-26T18:50:00Z") }))(post({ misja: "raport", pola: { temat: "Czujniki dymu" } }));
  const data = await res.json();
  check("Misja OK → raport, agent dostał wyszukiwanie", res.status === 200 && data.raport.sekcje.length === 5 && lastTools && "web_search" in lastTools && lastStep === 6);
  check("Pod wynikiem: data i godzina wykonania", data.raport.wykonano === "2026-11-26T18:50:00.000Z");
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
check("Porównanie: pola Firma 1–3, Kryteria i „Dla kogo wybieramy”", cmp.pola.map((f) => f.name).join() === "firma1,firma2,firma3,kryteria,dla_kogo" && cmp.pola[4].label === "Dla kogo wybieramy");
const P = { firma1: "Ajax", firma2: "Texecom", firma3: "Pyronix", kryteria: "cena, aplikacja mobilna ,  gwarancja", dla_kogo: "dla trzyosobowego biura z małym budżetem" };
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
], rekomendacja: { podstawy: true, firma: "ajax", warunek: "rozbudowanej aplikacji mobilnej", uzasadnienie: "Ma najwięcej funkcji w aplikacji (https://x.example)." } };
const vc = validateComparisonOutput(out, P, srcs);
check("Poprawny wynik porównania przechodzi", vc.success);
check("Zero i puste → „brak danych”, linki usunięte, nazwa firmy z formularza", vc.success && vc.value.wiersze[0].wartosci[1] === NO_DATA && vc.value.wiersze[2].wartosci[1] === NO_DATA && vc.value.rekomendacja.firma === "Ajax" && !vc.value.rekomendacja.uzasadnienie.includes("http"));
check("Brakujący wiersz → odrzucone", !validateComparisonOutput({ ...out, wiersze: out.wiersze.slice(0, 2) }, P, srcs).success);
check("Inne kryterium niż wpisane → odrzucone", !validateComparisonOutput({ ...out, wiersze: [{ ...out.wiersze[0], kryterium: "jakość" }, ...out.wiersze.slice(1)] }, P, srcs).success);
check("Firma bez oceny (2 wartości) → odrzucone", !validateComparisonOutput({ ...out, wiersze: [{ kryterium: "cena", wartosci: ["a", "b"] }, ...out.wiersze.slice(1)] }, P, srcs).success);
check("Rekomendacja spoza trzech firm → odrzucona", !validateComparisonOutput({ ...out, rekomendacja: { ...out.rekomendacja, firma: "Bosch" } }, P, srcs).success);
check("Rekomendacja bez warunku → odrzucona", !validateComparisonOutput({ ...out, rekomendacja: { ...out.rekomendacja, warunek: " " } }, P, srcs).success);
const many = { ...out, wiersze: out.wiersze.map((w, i) => ({ ...w, wartosci: i === 1 ? w.wartosci : ["brak danych", "0", ""] })) };
const vm = validateComparisonOutput(many, P, srcs);
check("Za dużo „brak danych” → brak podstaw do rekomendacji (wymusza serwer)", vm.success && vm.value.rekomendacja.podstawy === false && buildComparison(vm.value, P, srcs).sekcje[1].tekst === NO_BASIS_TEXT);
const vn = validateComparisonOutput({ ...out, rekomendacja: { podstawy: false, firma: "", warunek: "", uzasadnienie: "Za mało danych." } }, P, srcs);
check("Agent sam pisze „brak podstaw” → przechodzi", vn.success && buildComparison(vn.value, P, srcs).sekcje[1].tekst === NO_BASIS_TEXT);
const cr = buildComparison(vc.value, P, srcs);
check("Tabela z pól: firmy w kolumnach, kryteria w wierszach", cr.sekcje[0].typ === "tabela" && cr.sekcje[0].kolumny.join() === "Ajax,Texecom,Pyronix" && cr.sekcje[0].wiersze.map((w) => w.kryterium).join() === "cena,aplikacja mobilna,gwarancja");
check("Pod tabelą: rekomendacja, potem źródła z wyszukiwania", cr.sekcje[1].tytul === "Rekomendacja" && cr.sekcje[1].tekst === "Ajax – najlepszy wybór, jeśli zależy Ci na rozbudowanej aplikacji mobilnej. Ma najwięcej funkcji w aplikacji." && cr.sekcje[2].typ === "linki" && cr.sekcje[2].linki.length === 2);
const v0 = validateComparisonOutput(out, P, []);
check("Bez źródeł z wyszukiwania → wszystkie komórki „brak danych” i brak podstaw do rekomendacji", v0.success && v0.value.wiersze.every((w) => w.wartosci.every((c) => c === NO_DATA)) && buildComparison(v0.value, P, []).sekcje[1].tekst === NO_BASIS_TEXT);
check("Porównanie w dwóch krokach: zbieranie o każdej firmie, potem tabela z notatek", !!cmp.zbieranie && /KAŻDEJ z trzech firm/.test(COMPARISON_RESEARCH_INSTRUCTIONS) && /adres strony/.test(COMPARISON_RESEARCH_INSTRUCTIONS) && /WYŁĄCZNIE na podstawie notatek/.test(COMPARISON_INSTRUCTIONS) && /<notatki>[\s\S]*<zrodla>/.test(cmp.prompt(P, { notatki: "n", zrodla: srcs })));
check("Instrukcja: dane, „brak danych”, bez zera, bez linków", /DANE/.test(COMPARISON_INSTRUCTIONS) && /„brak danych”/.test(COMPARISON_INSTRUCTIONS) && /nie wpisuj zera/.test(COMPARISON_INSTRUCTIONS) && /Nie wpisuj adresów/.test(COMPARISON_INSTRUCTIONS));
check("Prompt: firmy i kryteria w znacznikach", /<firmy>[\s\S]*Texecom[\s\S]*<\/firmy>/.test(cmp.prompt(P)) && /<kryteria>[\s\S]*gwarancja/.test(cmp.prompt(P)));
{
  modelCalls = 0;
  const res = await createMissionHandler(deps())(post({ misja: "porownanie", pola: { ...P, kryteria: "cena" } }));
  check("Endpoint: złe kryteria → 400 bez modelu", res.status === 400 && modelCalls === 0);
}

// --- Dla szybkich: „Dla kogo wybieramy” i „Kopiuj jako tekst”
check("Brak „Dla kogo” → komunikat", !readMissionFields(cmp, { ...P, dla_kogo: " " }).ok && !readMissionFields(cmp, { ...P, dla_kogo: "a".repeat(151) }).ok);
check("„Dla kogo” trafia do modelu w obu krokach jako dane", /<dla_kogo>\ndla trzyosobowego biura/.test(cmp.zbieranie.prompt(P)) && /<dla_kogo>/.test(cmp.prompt(P, { notatki: "n", zrodla: srcs })));
check("Instrukcja: rekomendacja bierze pod uwagę <dla_kogo> i powołuje się na nie", /brać pod uwagę opis z <dla_kogo>/.test(COMPARISON_INSTRUCTIONS) && /powołaj się na ten opis/.test(COMPARISON_INSTRUCTIONS) && /<dla_kogo>/.test(COMPARISON_RESEARCH_INSTRUCTIONS));
check("Wynik porównania pokazuje „Dla kogo: …”", cr.opis === "Dla kogo: dla trzyosobowego biura z małym budżetem");
const fmt = () => "26.11.2026, 19:20";
const tCmp = reportToText({ ...cr, wykonano: "2026-11-26T19:20:00Z" }, fmt);
check("Kopiuj jako tekst (porównanie): tytuł, dla kogo, tabela w wierszach, rekomendacja, źródła z adresami, data",
  tCmp.startsWith("Porównanie: Ajax / Texecom / Pyronix\nDla kogo: dla trzyosobowego") && /cena:\n  Ajax – od £200\n  Texecom – brak danych/.test(tCmp) && /REKOMENDACJA\nAjax – najlepszy wybór/.test(tCmp) && /- GOV\.UK – https:\/\/gov\.uk\/smoke/.test(tCmp) && tCmp.endsWith("Misja wykonana: 26.11.2026, 19:20"));
const tRep = reportToText(rep, fmt);
check("Kopiuj jako tekst (raport): fakty z numerami, ponumerowane źródła", /FAKTY\n- Fakt \[1\]\n- F2\. \[2\]/.test(tRep) && /\[2\] example\.org – http:\/\/example\.org\/a/.test(tRep) && !/<|>/.test(tRep));

// --- Warsztat 3: Notatka z wizyty (baza wiedzy, bez internetu)
const wiz = findMission("wizyta");
check("Wizyta: jedno pole wieloliniowe, do 4000 znaków, opis widoczny", wiz.pola.length === 1 && wiz.pola[0].multiline === true && wiz.pola[0].maxLength === 4000 && wiz.opis.length > 20);
check("Wizyta: bez internetu, z bazą wiedzy", wiz.wyszukiwanie === false && wiz.bazaWiedzy === true && !wiz.zbieranie);
const frag = [{ tytul: "Cennik Amber Security", tresc: "Wymiana baterii w centrali: £45 + VAT. Przegląd roczny od £120.", podobienstwo: 0.7 }];
const wp = wiz.prompt({ notatki: "bateria słaba" }, { notatki: "", zrodla: [], fragmenty: frag });
check("Wizyta: notatki i fragmenty bazy jako dane w znacznikach", /<notatki_z_wizyty>\nbateria słaba\n<\/notatki_z_wizyty>/.test(wp) && /Dokument: Cennik Amber Security/.test(wp));
check("Wizyta: brak fragmentów → widoczne „brak pasujących fragmentów”", /brak pasujących fragmentów/.test(wiz.prompt({ notatki: "x" }, { notatki: "", zrodla: [], fragmenty: [] })));
const vgood = { zrobione: ["Sprawdzono centralę Texecom.", "Bateria w centrali słaba."], zalecenia: ["Wymiana baterii w centrali."], szkic: `Dzień dobry,\nwymiana baterii kosztuje £45 + VAT.\n${VISIT_SIGNATURE}`, zrodla: ["Cennik Amber Security"] };
check("Wizyta: poprawny wynik przechodzi", validateVisitOutput(vgood, {}, [], frag).success);
check("Wizyta: kwota spoza bazy → odrzucona", !validateVisitOutput({ ...vgood, szkic: `Koszt £60.\n${VISIT_SIGNATURE}` }, {}, [], frag).success);
check("Wizyta: kwota z bazy bez źródła → odrzucona", !validateVisitOutput({ ...vgood, zrodla: [] }, {}, [], frag).success);
check("Wizyta: źródło spoza wyników bazy → odrzucone", !validateVisitOutput({ ...vgood, zrodla: ["Cennik konkurencji"] }, {}, [], frag).success);
check("Wizyta: [DO UZUPEŁNIENIA] bez źródła przechodzi", validateVisitOutput({ ...vgood, szkic: `Cena: [DO UZUPEŁNIENIA: cena czujki].\n${VISIT_SIGNATURE}`, zrodla: [] }, {}, [], []).success);
check("Wizyta: szkic bez podpisu → odrzucony", !validateVisitOutput({ ...vgood, szkic: "Dzień dobry." }, {}, [], frag).success);
check("Wizyta: brak zaleceń / za dużo punktów → odrzucone", !validateVisitOutput({ ...vgood, zalecenia: [] }, {}, [], frag).success && !validateVisitOutput({ ...vgood, zrobione: Array(9).fill("x") }, {}, [], frag).success);
const vr = buildVisit(validateVisitOutput(vgood, {}, [], frag).value);
check("Wizyta: sekcje Co zrobiono / co znaleziono, Zalecenia, Szkic, Źródła z bazy wiedzy", vr.sekcje.map((x) => x.tytul).join("|") === "Co zrobiono / co znaleziono|Zalecenia|Szkic wiadomości do klienta|Źródła z bazy wiedzy" && vr.sekcje[3].punkty[0] === "📎 Cennik Amber Security");
check("Wizyta: szkic zachowuje podpis w osobnej linii", vr.sekcje[2].tekst.endsWith(`\n${VISIT_SIGNATURE}`));
check("Wizyta: bez źródeł → „Brak – …”", buildVisit(validateVisitOutput({ ...vgood, szkic: `Dziękujemy.\n${VISIT_SIGNATURE}`, zrodla: [] }, {}, [], []).value).sekcje[3].tekst === NO_KB_SOURCES_TEXT);
check("Instrukcja wizyty: dane, ceny tylko z bazy, DO UZUPEŁNIENIA, bez obietnic i telefonów", /DANE/.test(VISIT_INSTRUCTIONS) && /WYŁĄCZNIE z pasujących fragmentów/.test(VISIT_INSTRUCTIONS) && /\[DO UZUPEŁNIENIA/.test(VISIT_INSTRUCTIONS) && /Niczego nie obiecuj/.test(VISIT_INSTRUCTIONS) && /niezwłocznie/.test(VISIT_INSTRUCTIONS) && /numerów telefonu/.test(VISIT_INSTRUCTIONS));
{
  let searched = 0, gotSearch = null, gotTools = null;
  const kb = async () => { searched++; return { ok: true, fragmenty: frag }; };
  const d = deps({ searchKnowledge: kb, run: async ({ tools, searchKnowledge }) => { gotTools = tools; gotSearch = searchKnowledge; return { ok: true, raport: vr }; } });
  const res = await createMissionHandler({ ...d, getSession: () => null })(post({ misja: "wizyta", pola: { notatki: "x" } }));
  check("Wizyta: bez zalogowania → 401, bez bazy i modelu", res.status === 401 && searched === 0);
  const ok = await createMissionHandler(d)(post({ misja: "wizyta", pola: { notatki: "bateria słaba" } }));
  check("Wizyta: agent dostaje tylko bazę wiedzy – bez wyszukiwania w internecie", ok.status === 200 && gotSearch === kb && gotTools && Object.keys(gotTools).length === 0);
  const noKb = await createMissionHandler(deps({ searchKnowledge: null }))(post({ misja: "wizyta", pola: { notatki: "x" } }));
  check("Wizyta: brak bazy wiedzy → 500 z komunikatem", noKb.status === 500);
}

// --- pliki
const lib = read("lib/amber-missions.ts");
check("Misje: limit kroków jak w czacie (AGENT_STEP_LIMIT), 60 s", /isStepCount\(stepLimit\)/.test(lib) && /stepLimit: AGENT_STEP_LIMIT/.test(read("app/api/missions/route.ts")) && /MISSION_TIMEOUT_MS = 60_000/.test(lib));
check("Misje: bez bazy i bez wysyłania", !/supabase|from\(|insert|fetch\(/i.test(lib));
const model = read("lib/model.ts");
check("lib/model.ts: webSearchTool z ustawieniami czatu", /export function webSearchTool/.test(model) && /maxResults: 3, engine: "native"/.test(model));
check("Czat korzysta z tego samego wyszukiwania", /web_search: createWebSearchTool\(openrouter\)/.test(read("app/api/agent/route.ts")));
const route = read("app/api/missions/route.ts");
check("Endpoint: sesja, model, wyszukiwanie, baza wiedzy", /getApiSession/.test(route) && /webSearchTool\(\)/.test(route) && /force-dynamic/.test(route) && /searchKnowledge\(query/.test(route) && /createSupabaseServerClient/.test(route));
const page = read("app/misje/page.tsx");
check("Strona /misje tylko dla zalogowanych", /getCurrentUser/.test(page) && /redirect\(loginUrl\("\/misje"\)\)/.test(page) && /force-dynamic/.test(page));
const form = read("app/misje/missions-form.tsx");
check("Formularz: „Uruchom misję”, „Agent pracuje…”, blokada, komunikat błędu", /Uruchom misję/.test(form) && /Agent pracuje…/.test(form) && /disabled=\{pending/.test(form) && /setError/.test(form) && /finally/.test(form));
check("Formularz: data wykonania i ponumerowane źródła", /Misja wykonana:/.test(form) && /mission-sources/.test(form) && /\[\{i \+ 1\}\]/.test(form));
check("Formularz: „Kopiuj jako tekst” przy wyniku obu misji", /Kopiuj jako tekst/.test(form) && /reportToText\(report\)/.test(form) && /Skopiowano ✓/.test(form));
check("Formularz: pole wieloliniowe (textarea)", /field\.multiline \?/.test(form) && /<textarea/.test(form));
check("Formularz: tabela i wyszarzone „brak danych”", /mission-table/.test(form) && /no-data/.test(form));
check("Formularz: klikalne linki w nowej karcie", /target="_blank" rel="noopener noreferrer"/.test(form));
check("Link „Misje” w nawigacji", /href="\/misje"[^>]*>\s*Misje/.test(read("app/chat.tsx")));

console.log(`\nWynik: ${ok} zaliczonych, ${bad} niezaliczonych.`);
if (bad) process.exitCode = 1;
