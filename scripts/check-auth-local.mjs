// Lekcja 7 (Standard): sprawdzenie logowania na DZIAŁAJĄCYM serwerze (npm run dev) – wynik w tabelce.
// Uruchamianie (okno poleceń): node --experimental-strip-types scripts/check-auth-local.mjs
// Skrypt zakłada TYMCZASOWE konto testowe, sprawdza rejestrację, logowanie, złe hasło, wylogowanie
// i dostęp bez sesji, a na końcu USUWA to konto (klucz serwera z .env.local – wartości nie są wypisywane).
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { AUTH_MESSAGES, authErrorMessage } from "../lib/amber-auth-messages.ts";

process.loadEnvFile(".env.local");
const BASE = process.argv[2] ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) {
  console.log("Brak NEXT_PUBLIC_SUPABASE_URL lub NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY w .env.local.");
  process.exit(1);
}

const rows = [];
const add = (test, expected, got, ok) => rows.push({ test, expected, got: String(got), ok });

// Ciasteczka „przeglądarki” w pamięci skryptu (ten sam format co @supabase/ssr w aplikacji).
function makeBrowser() {
  const jar = new Map();
  const client = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value, options }) => (value && options?.maxAge !== 0 ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const cookie = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  return { client, cookie, jar };
}
const hit = (path, { method = "GET", body, cookie } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

try {
  await fetch(`${BASE}/login`, { redirect: "manual" });
} catch {
  console.log(`Serwer ${BASE} nie odpowiada. Uruchom „npm run dev” w oknie serwera i spróbuj ponownie.`);
  process.exit(1);
}

// 1. Każdy endpoint bez sesji → 401
const endpoints = [
  ["POST", "/api/agent", { mode: "chat", messages: [] }],
  ["POST", "/api/agent (analyze)", { mode: "analyze", text: "test" }],
  ["GET", "/api/conversations/latest"],
  ["GET", "/api/conversations/1"],
  ["DELETE", "/api/conversations/1"],
  ["GET", "/api/profile"],
  ["PATCH", "/api/profile", { imie: "x" }],
  ["DELETE", "/api/profile", { wszystko: true }],
  ["GET", "/api/upload"],
  ["POST", "/api/upload", { tytul: "x", tekst: "y" }],
  ["DELETE", "/api/upload", { id: 1 }],
  ["POST", "/api/dashboard", { miasto: "Londyn", data: "2026-12-01" }],
];
for (const [method, label, body] of endpoints) {
  const path = label.split(" ")[0];
  const r = await hit(path, { method, body });
  add(`${method} ${label} bez sesji`, "401", r.status, r.status === 401);
}

// 2. Strona chroniona bez sesji → /login z zapamiętanym celem
{
  const r = await hit("/upload");
  const loc = r.headers.get("location") ?? "";
  add("Wejście na /upload bez sesji", "307 → /login?next=%2Fupload", `${r.status} → ${loc.replace(BASE, "")}`, r.status === 307 && loc.endsWith("/login?next=%2Fupload"));
  const evil = await hit("/login?next=https://zla.strona");
  add("/login?next=obca strona", "200 (bez przekierowania na obcą)", evil.status, evil.status === 200);
}

// 3. Rejestracja, sesja, wylogowanie, logowanie, złe hasło – na tymczasowym koncie
const email = `amber.kurs.test.${Date.now()}@gmail.com`;
const password = `Test-${crypto.randomUUID()}`;
let userId = null;
{
  const b = makeBrowser();
  const { data, error } = await b.client.auth.signUp({ email, password });
  userId = data?.user?.id ?? null;
  add("Rejestracja nowego konta", "sesja od razu", error ? authErrorMessage(error, "signup") : data.session ? "sesja ✔" : "brak sesji (Confirm email?)", !error && Boolean(data.session));
  const withSession = await hit("/api/profile", { cookie: b.cookie() });
  add("Po rejestracji: GET /api/profile", "200", withSession.status, withSession.status === 200);
  const page = await hit("/upload", { cookie: b.cookie() });
  add("Po rejestracji: strona /upload", "200", page.status, page.status === 200);

  await b.client.auth.signOut();
  const after = await hit("/api/profile", { cookie: b.cookie() });
  add("Wylogowanie → ciasteczka usunięte", "brak ciasteczek sesji", b.jar.size === 0 ? "brak ✔" : `zostało ${b.jar.size}`, b.jar.size === 0);
  add("Po wylogowaniu: GET /api/profile", "401", after.status, after.status === 401);
  const afterPage = await hit("/upload", { cookie: b.cookie() });
  add("Po wylogowaniu: strona /upload", "307 → /login", `${afterPage.status}`, afterPage.status === 307);
}
{
  const b = makeBrowser();
  const { data, error } = await b.client.auth.signInWithPassword({ email, password });
  add("Logowanie poprawnym hasłem", "sesja", error ? authErrorMessage(error, "login") : data.session ? "sesja ✔" : "brak sesji", !error && Boolean(data.session));
  const r = await hit("/api/profile", { cookie: b.cookie() });
  add("Po zalogowaniu: GET /api/profile", "200", r.status, r.status === 200);
  await b.client.auth.signOut();
}
{
  const b = makeBrowser();
  const { error } = await b.client.auth.signInWithPassword({ email, password: "zle-haslo-123" });
  const msg = authErrorMessage(error, "login");
  add("Logowanie złym hasłem", AUTH_MESSAGES.wrongPassword, error ? msg : "zalogowano (BŁĄD)", Boolean(error) && msg === AUTH_MESSAGES.wrongPassword);
  add("Złe hasło: brak sesji", "brak ciasteczek", b.jar.size === 0 ? "brak ✔" : "są", b.jar.size === 0);
}

// 4. Sprzątanie: usunięcie konta testowego
if (userId && SECRET) {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.deleteUser(userId);
  add("Sprzątanie: konto testowe usunięte", "tak", error ? "nie – usuń ręcznie w Supabase" : "tak", !error);
}

const w = [Math.max(...rows.map((r) => r.test.length), 4), Math.max(...rows.map((r) => r.expected.length), 11), Math.max(...rows.map((r) => r.got.length), 5)];
const line = (a, b, c, d) => `| ${a.padEnd(w[0])} | ${b.padEnd(w[1])} | ${c.padEnd(w[2])} | ${d} |`;
console.log(line("Test", "Oczekiwane", "Wynik", "OK"));
console.log(`|${"-".repeat(w[0] + 2)}|${"-".repeat(w[1] + 2)}|${"-".repeat(w[2] + 2)}|----|`);
for (const r of rows) console.log(line(r.test, r.expected, r.got, r.ok ? "✅" : "❌"));
const bad = rows.filter((r) => !r.ok).length;
console.log(`\nRazem: ${rows.length - bad}/${rows.length} zgodnie z oczekiwaniem.`);
process.exitCode = bad ? 1 : 0;
