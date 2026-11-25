// Lekcja 7, Warsztat 3 (Standard): sprawdzenie tras logowania przez Google na DZIAŁAJĄCYM serwerze.
// Uruchamianie: node --experimental-strip-types scripts/check-google-flow.mjs
// Sprawdza to, co da się bez ekranu Google: start logowania, powrót z anulowaniem i z błędem, ochronę stron.
// Samo logowanie i „Anuluj” na ekranie Google robi się w przeglądarce (wyniki dopisujemy do tabelki).
const BASE = process.argv[2] ?? "http://localhost:3000";
const rows = [];
const add = (test, expected, got, ok) => rows.push({ test, expected, got: String(got), ok });
const hit = (path, cookie) => fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
const where = (r) => (r.headers.get("location") ?? "").replace(BASE, "");

try {
  await hit("/login");
} catch {
  console.log(`Serwer ${BASE} nie odpowiada. Uruchom „npm run dev” w oknie serwera.`);
  process.exit(1);
}

{
  const r = await hit("/auth/google?next=%2Fhistory");
  const loc = r.headers.get("location") ?? "";
  let u = null;
  try { u = new URL(loc); } catch {}
  const redirectTo = u?.searchParams.get("redirect_to") ?? "";
  const cookie = r.headers.get("set-cookie") ?? "";
  add("Start „Zaloguj przez Google”", "307 → Supabase /authorize?provider=google", `${r.status} → ${u ? u.host + u.pathname : "?"} provider=${u?.searchParams.get("provider")}`,
    r.status === 307 && u?.pathname === "/auth/v1/authorize" && u.searchParams.get("provider") === "google");
  add("Adres powrotu z adresu serwera (bez localhost na sztywno)", `${BASE}/auth/callback?next=/history`, redirectTo, redirectTo === `${BASE}/auth/callback?next=%2Fhistory`);
  add("Ciasteczko PKCE (code verifier) w odpowiedzi", "jest", /code-verifier/.test(cookie) ? "jest" : "brak", /code-verifier/.test(cookie));
}
{
  const r = await hit("/auth/google?next=https%3A%2F%2Fzla.strona");
  const redirectTo = new URL(r.headers.get("location") ?? "http://x").searchParams.get("redirect_to") ?? "";
  add("Start z obcym adresem w next", "next=/ (czat)", redirectTo.replace(BASE, ""), redirectTo === `${BASE}/auth/callback?next=%2F`);
}
{
  const r = await hit("/auth/callback?error=access_denied&error_description=The+user+denied");
  add("Anulowanie na ekranie Google (error=access_denied)", "→ /login?blad=anulowano", `${r.status} → ${where(r)}`, r.status === 307 && where(r) === "/login?blad=anulowano");
}
{
  const r = await hit("/auth/callback?error=server_error");
  add("Błąd dostawcy", "→ /login?blad=google", `${r.status} → ${where(r)}`, r.status === 307 && where(r) === "/login?blad=google");
}
{
  const r = await hit("/auth/callback");
  add("Powrót bez kodu", "→ /login?blad=google", `${r.status} → ${where(r)}`, r.status === 307 && where(r) === "/login?blad=google");
}
{
  const r = await hit("/auth/callback?code=zmyslony-kod");
  add("Zmyślony kod", "→ /login?blad=google, bez sesji", `${r.status} → ${where(r)}`, r.status === 307 && where(r) === "/login?blad=google" && !/auth-token=/.test(r.headers.get("set-cookie") ?? ""));
}
for (const [blad, text] of [["anulowano", "anulowane"], ["google", "Nie udało się zalogować przez Google"], ["<b>x</b>", null]]) {
  const r = await hit(`/login?blad=${encodeURIComponent(blad)}`);
  const html = await r.text();
  add(`/login?blad=${blad}`, text ? `komunikat „${text}…”` : "bez komunikatu (nieznany kod)", text ? (html.includes(text) ? "jest" : "brak") : (html.includes("<b>x</b>") ? "wstawiony!" : "bez komunikatu"),
    text ? html.includes(text) : !html.includes("<b>x</b>"));
}
{
  const r = await hit("/upload");
  add("Wejście na /upload bez sesji (po wylogowaniu)", "307 → /login?next=%2Fupload", `${r.status} → ${where(r)}`, r.status === 307 && where(r) === "/login?next=%2Fupload");
}

const w = [Math.max(...rows.map((r) => r.test.length)), Math.max(...rows.map((r) => r.expected.length)), Math.max(...rows.map((r) => r.got.length))];
console.log(`| ${"Test".padEnd(w[0])} | ${"Oczekiwane".padEnd(w[1])} | ${"Wynik".padEnd(w[2])} | OK |`);
console.log(`|${"-".repeat(w[0] + 2)}|${"-".repeat(w[1] + 2)}|${"-".repeat(w[2] + 2)}|----|`);
for (const r of rows) console.log(`| ${r.test.padEnd(w[0])} | ${r.expected.padEnd(w[1])} | ${r.got.padEnd(w[2])} | ${r.ok ? "✅" : "❌"} |`);
console.log(`\nRazem: ${rows.filter((r) => r.ok).length}/${rows.length}.`);
