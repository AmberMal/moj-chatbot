// Lekcja 8, Warsztat 1: misja „Triage maili” – podział, walidator, kolejność „najpierw użytkownik”, błędy kart.
// Uruchamianie: node --experimental-strip-types scripts/test-amber-triage.mjs
import { readFileSync } from "node:fs";
import {
  MAX_TRIAGE_EMAILS, TRIAGE_CATEGORIES, TRIAGE_MESSAGES, TRIAGE_PRIORITIES, TRIAGE_INSTRUCTIONS,
  createTriageHandler, splitEmails, validateTriageOutput,
} from "../lib/amber-triage.ts";

let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log(`✅ ${name}`); } else { bad++; console.log(`❌ NIE: ${name} ${extra}`); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const good = { nadawca: "Jan Kowalski", temat: "Awaria alarmu", kategoria: "problem techniczny", priorytet: "wysoki", uzasadnienie: "System nie działa.", szkic: "Dzień dobry,\nsprawdzimy sprawę.\nZespół obsługi" };

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
check("Szkic bez podpisu „Zespół obsługi” → odrzucony", !validateTriageOutput({ ...good, szkic: "Dzień dobry." }).success);
check("Puste pole → odrzucony", !validateTriageOutput({ ...good, temat: "  " }).success);
check("Instrukcja: mail = dane, bez obietnic (wpłata, cena, termin, zwrot), dopytywanie, podpis", /DANE/.test(TRIAGE_INSTRUCTIONS) && /wpłat/.test(TRIAGE_INSTRUCTIONS) && /zwrot/.test(TRIAGE_INSTRUCTIONS) && /dopytuje/.test(TRIAGE_INSTRUCTIONS) && /Zespół obsługi/.test(TRIAGE_INSTRUCTIONS));

check("Instrukcja bez nazwy firmy i bez oceniania oferty", !/Amber/.test(TRIAGE_INSTRUCTIONS) && /Nie oceniasz, czy firma coś oferuje/.test(TRIAGE_INSTRUCTIONS));
check("Instrukcja: nie pisze, że coś zrobione („przekazaliśmy”), nie obiecuje czasu", /przekazaliśmy/.test(TRIAGE_INSTRUCTIONS) && /niezwłocznie/.test(TRIAGE_INSTRUCTIONS));
check("Instrukcja: pytanie o cenę/zapis/fakturę → „oferta i ceny”", /Pytanie o cenę, ofertę, zapis, fakturę za usługę – „oferta i ceny”/.test(TRIAGE_INSTRUCTIONS));
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

console.log(`\nWynik: ${ok} zaliczonych, ${bad} niezaliczonych.`);
process.exitCode = bad === 0 ? 0 : 1;
