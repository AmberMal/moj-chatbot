// Lekcja 8, Warsztat 1: misja „Triage maili” – podział, walidator, kolejność „najpierw użytkownik”, błędy kart.
// Uruchamianie: node --experimental-strip-types scripts/test-amber-triage.mjs
import { readFileSync } from "node:fs";
import {
  MAX_TRIAGE_EMAILS, TRIAGE_CATEGORIES, TRIAGE_MESSAGES, TRIAGE_PRIORITIES, TRIAGE_INSTRUCTIONS,
  createTriageHandler, splitEmails, validateTriageOutput, checkTriageSources, fragmentsBlock,
} from "../lib/amber-triage.ts";
import { sortTriageCards, triageSummary } from "../lib/amber-triage-view.ts";

let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log(`✅ ${name}`); } else { bad++; console.log(`❌ NIE: ${name} ${extra}`); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const good = { nadawca: "Jan Kowalski", temat: "Awaria alarmu", kategoria: "awaria i serwis", priorytet: "wysoki", uzasadnienie: "System nie działa.", szkic: "Dzień dobry,\nsprawdzimy sprawę.\nAmber, Amber Security Systems", zrodla: [] };

console.log("\n=== 1. Podział na maile ===");
check("Separator --- (sama linia), puste części pominięte", JSON.stringify(splitEmails("A\n---\nB\n\n---\n\n---\nC")) === JSON.stringify(["A", "B", "C"]));
check("Separator ze spacjami i \\r\\n", splitEmails("A\r\n  ---  \r\nB").length === 2);
check("--- w środku linii to nie separator", splitEmails("Cena --- do ustalenia\nOK").length === 1);
check("Pusty tekst → 0 maili", splitEmails("  \n---\n ").length === 0);

console.log("\n=== 2. Walidator (wynik sprawdzany na serwerze) ===");
check("Poprawny wynik przechodzi", validateTriageOutput(good).success);
check("Dokładnie 5 kategorii i 3 priorytety", TRIAGE_CATEGORIES.length === 5 && TRIAGE_PRIORITIES.join() === "wysoki,średni,niski");
check("Zła kategoria → odrzucony", !validateTriageOutput({ ...good, kategoria: "sprzedaż" }).success);
check("Zły priorytet → odrzucony", !validateTriageOutput({ ...good, priorytet: "pilny" }).success);
check("Brak pola → odrzucony", !validateTriageOutput({ ...good, szkic: undefined }).success);
check("Dodatkowe pole (np. wyslij) → odrzucony", !validateTriageOutput({ ...good, wyslij: true }).success);
check("Szkic bez podpisu „Amber, Amber Security Systems” → odrzucony", !validateTriageOutput({ ...good, szkic: "Dzień dobry." }).success);
check("Puste pole → odrzucony", !validateTriageOutput({ ...good, temat: "  " }).success);
check("Instrukcja: mail = dane, bez obietnic (wpłata, cena, termin, zwrot), dopytywanie, podpis", /DANE/.test(TRIAGE_INSTRUCTIONS) && /wpłat/.test(TRIAGE_INSTRUCTIONS) && /zwrot/.test(TRIAGE_INSTRUCTIONS) && /dopytuje/.test(TRIAGE_INSTRUCTIONS) && /Amber, Amber Security Systems/.test(TRIAGE_INSTRUCTIONS));

check("Instrukcja: nie ocenia, czy firma coś oferuje", /Nie oceniasz, czy firma coś oferuje/.test(TRIAGE_INSTRUCTIONS));
check("Instrukcja: nie pisze, że coś zrobione („przekazaliśmy”), nie obiecuje czasu", /przekazaliśmy/.test(TRIAGE_INSTRUCTIONS) && /niezwłocznie/.test(TRIAGE_INSTRUCTIONS));
check("Kategorie Amber: wycena i oferta / awaria i serwis / reklamacja / faktury i płatności / inne", TRIAGE_CATEGORIES.join() === "wycena i oferta,awaria i serwis,reklamacja,faktury i płatności,inne");
check("Instrukcja: ukryta reklamacja w pytaniu o cenę → „reklamacja”", /nawet jeśli uprzejmie pyta o cenę/.test(TRIAGE_INSTRUCTIONS));
check("Instrukcja: priorytet wysoki (system nie działa, bez ochrony, pilne) i niski (rozglądam się)", /obiekt jest bez ochrony/.test(TRIAGE_INSTRUCTIONS) && /na razie się rozglądam/.test(TRIAGE_INSTRUCTIONS));
check("Instrukcja: styl Amber, język klienta", /Jesteś Amber/.test(TRIAGE_INSTRUCTIONS) && /w języku klienta/.test(TRIAGE_INSTRUCTIONS));
check("Stara kategoria „oferta i ceny” odrzucona", !validateTriageOutput({ ...good, kategoria: "oferta i ceny" }).success);
console.log("\n=== 3. Endpoint ===");
const req = (body) => new Request("http://localhost/api/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const calls = { model: 0, gen: 0 };
const make = (generate, session = true) => createTriageHandler({
  getSession: async () => (session ? { token: "u1" } : null),
  createModel: () => { calls.model++; return {}; },
  generate, log: () => {},
});
{
  const r = await make(async () => { calls.gen++; return { ok: true, output: good }; }, false)(req({ tekst: "A" }));
  check("Bez zalogowanej osoby → 401, model ani razu", r.status === 401 && calls.model === 0 && calls.gen === 0);
}
{
  const many = Array.from({ length: MAX_TRIAGE_EMAILS + 1 }, (_, i) => `Mail ${i}`).join("\n---\n");
  const r = await make(async () => ({ ok: true, output: good }))(req({ tekst: many }));
  check("11 maili → 400 „Najwyżej 10…”, bez modelu", r.status === 400 && (await r.json()).komunikat === TRIAGE_MESSAGES.tooMany && calls.model === 0);
  check("Pusty tekst → 400", (await make(async () => ({ ok: true, output: good }))(req({ tekst: " --- " }))).status === 400);
  check("Złe dane → 400", (await make(async () => ({ ok: true, output: good }))(req({ x: 1 }))).status === 400);
}
{
  const seen = [];
  const gen = async ({ email }) => {
    seen.push(email);
    await new Promise((r) => setTimeout(r, email === "M1" ? 30 : 5));
    if (email === "M2") return { ok: false, kind: "invalid_output", details: "zła kategoria" };
    return { ok: true, output: { ...good, temat: `T-${email}` } };
  };
  const r = await make(gen)(req({ tekst: "M1\n---\nM2\n---\nM3" }));
  const { karty } = await r.json();
  check("Każdy mail osobnym wywołaniem", seen.length === 3 && new Set(seen).size === 3);
  check("Karty w kolejności maili (mimo różnego czasu)", karty.map((k) => k.numer).join() === "1,2,3" && karty[0].temat === "T-M1" && karty[2].temat === "T-M3");
  check("Jeden mail się nie udał – jego karta z komunikatem po polsku, pozostałe normalne", karty[1].ok === false && karty[1].komunikat === TRIAGE_MESSAGES.invalid_output && karty[0].ok && karty[2].ok);
  check("Szczegóły techniczne błędu nie trafiają do przeglądarki", !JSON.stringify(karty).includes("zła kategoria"));
}

console.log("\n=== 4. Pliki ===");
const route = read("app/api/triage/route.ts"), page = read("app/email-triage/page.tsx"), form = read("app/email-triage/triage-form.tsx"), chat = read("app/chat.tsx");
check("Endpoint: getApiSession jak pozostałe", route.includes("getSession: () => getApiSession()"));
check("Strona tylko dla zalogowanych, dynamiczna", page.includes('if (!user) redirect(loginUrl("/email-triage"))') && page.includes('export const dynamic = "force-dynamic"'));
check("Formularz: „Posortuj”, „Agent sortuje…”, blokada, „Kopiuj szkic”", form.includes('"Posortuj"') && form.includes("Agent sortuje…") && form.includes("disabled={pending") && form.includes("Kopiuj szkic"));
check("Brak przycisku „Wyślij” i wysyłania maili", !/Wyślij|mailto:|sendMail|nodemailer/i.test(form + route + read("lib/amber-triage.ts")));
check("Link „Triage” w nawigacji czatu", chat.includes('href="/email-triage"') && chat.includes("Triage"));

console.log("\n=== 5. Standard: baza wiedzy, znacznik, kolejność, podsumowanie ===");
const frag = [{ tytul: "Cennik Amber Security", tresc: "Przejęcie systemu od £888 + VAT.", podobienstwo: 0.7 }];
check("Pole zrodla wymagane (lista)", !validateTriageOutput({ ...good, zrodla: undefined }).success && !validateTriageOutput({ ...good, zrodla: "x" }).success);
check("Kwota z użytego fragmentu – OK", checkTriageSources({ ...good, szkic: "Koszt od £888 + VAT.\nAmber, Amber Security Systems", zrodla: ["Cennik Amber Security"] }, frag).length === 0);
check("Kwota spoza fragmentów (wymyślona) – odrzucona", checkTriageSources({ ...good, szkic: "Koszt 490 zł.\nAmber, Amber Security Systems", zrodla: [] }, frag).length > 0);
check("Kwota z fragmentu, ale bez źródła – odrzucona", checkTriageSources({ ...good, szkic: "Koszt £888.\nAmber, Amber Security Systems", zrodla: [] }, frag).length > 0);
check("Źródło spoza wyników wyszukiwania – odrzucone", checkTriageSources({ ...good, zrodla: ["Cennik 2026"] }, frag).length > 0);
check("Znacznik [DO UZUPEŁNIENIA: …] przechodzi bez źródła", checkTriageSources({ ...good, szkic: "Cena: [DO UZUPEŁNIENIA: cena warsztatów].\nAmber, Amber Security Systems", zrodla: [] }, []).length === 0);
check("Instrukcja: fragment tylko dla tej samej usługi, znacznik zamiast zmyślania", /tej samej usługi/.test(TRIAGE_INSTRUCTIONS) && /\[DO UZUPEŁNIENIA: czego brakuje\]/.test(TRIAGE_INSTRUCTIONS));
check("Fragmenty jako dane z tytułem dokumentu", fragmentsBlock(frag).includes("Dokument: Cennik Amber Security") && fragmentsBlock([], "brak").includes("brak pasujących"));
{
  const searched = []; const given = [];
  const h = createTriageHandler({ getSession: async () => ({}), createModel: () => ({}), log: () => {},
    searchKnowledge: async (q) => { searched.push(q); return { ok: true, fragmenty: frag }; },
    generate: async ({ fragments }) => { given.push(fragments.length); return { ok: true, output: { ...good, zrodla: ["Cennik Amber Security"] } }; } });
  const { karty } = await (await h(req({ tekst: "A\n---\nB" }))).json();
  check("Przed szkicem – wyszukiwanie w bazie dla każdego maila, fragmenty trafiają do modelu", searched.length === 2 && given.every((n) => n === 1));
  check("Karta niesie źródła", karty[0].zrodla[0] === "Cennik Amber Security");
  const h2 = createTriageHandler({ getSession: async () => null, createModel: () => ({}), log: () => {}, searchKnowledge: async () => { searched.push("X"); return { ok: true, fragmenty: [] }; }, generate: async () => ({ ok: true, output: good }) });
  await h2(req({ tekst: "A" }));
  check("Bez zalogowanej osoby – baza wiedzy nie jest przeszukiwana", !searched.includes("X"));
}
{
  const cards = [{ ok: true, numer: 1, priorytet: "niski" }, { ok: false, numer: 2 }, { ok: true, numer: 3, priorytet: "wysoki" }, { ok: true, numer: 4, priorytet: "średni" }, { ok: true, numer: 5, priorytet: "wysoki" }];
  check("Kolejność: wysoki → średni → niski, ten sam priorytet wg maili, błędy na końcu", sortTriageCards(cards).map((c) => c.numer).join() === "3,5,4,1,2");
  check("Podsumowanie: liczby wysoki/średni/niski", JSON.stringify(triageSummary(cards)) === JSON.stringify({ wysoki: 2, średni: 1, niski: 1, bledy: 1 }));
  check("Formularz: podsumowanie i „📎 Źródło:”", read("app/email-triage/triage-form.tsx").includes("TriageSummary") && read("app/email-triage/triage-form.tsx").includes("📎 Źródło:"));
}

console.log(`\nWynik: ${ok} zaliczonych, ${bad} niezaliczonych.`);
process.exitCode = bad === 0 ? 0 : 1;
