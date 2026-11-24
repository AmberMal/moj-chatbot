// Lekcja 7 (Dla szybkich): „tester bezpieczeństwa” – próby wejścia bez konta na DZIAŁAJĄCYM serwerze.
// Uruchamianie (okno poleceń, przy działającym npm run dev):
//   node --experimental-strip-types scripts/check-auth-attacks.mjs
// Niczego nie naprawia – tylko sprawdza i wypisuje tabelkę. Do prób z prawdziwą sesją zakłada
// TYMCZASOWE konto testowe i na końcu je usuwa (klucz serwera z .env.local; wartości nie są wypisywane).
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

process.loadEnvFile(".env.local");
const BASE = process.argv[2] ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SB_SECRET = process.env.SUPABASE_SECRET_KEY;
if (!SB_URL || !SB_KEY) {
  console.log("Brak NEXT_PUBLIC_SUPABASE_URL lub NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY w .env.local.");
  process.exit(1);
}
const COOKIE_NAME = `sb-${new URL(SB_URL).hostname.split(".")[0]}-auth-token`;

const rows = [];
// verdict: "ok" | "warn" | "bad"
const add = (group, attempt, answer, verdict, note = "") => rows.push({ group, attempt, answer: String(answer), verdict, note });

const hit = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const describe = (r) => {
  const loc = r.headers.get("location");
  return loc ? `${r.status} → ${loc.replace(BASE, "")}` : `${r.status}`;
};
const b64url = (obj) => Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64url");
const sessionCookie = (session) => `${COOKIE_NAME}=base64-${b64url(session)}`;

// „Przeglądarka” w pamięci skryptu (ten sam format ciasteczek co @supabase/ssr w aplikacji).
function makeBrowser() {
  const jar = new Map();
  const client = createServerClient(SB_URL, SB_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value, options }) => (value && options?.maxAge !== 0 ? jar.set(name, value) : jar.delete(name))),
    },
  });
  return { client, jar, cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

try {
  await fetch(`${BASE}/login`, { redirect: "manual" });
} catch {
  console.log(`Serwer ${BASE} nie odpowiada. Uruchom „npm run dev” w oknie serwera i spróbuj ponownie.`);
  process.exit(1);
}

// Cele: endpoint rozmowy (najdroższy – model), dane (profil), strony.
const agentBody = { mode: "chat", messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Cześć" }] }] };
const targets = [
  ["POST", "/api/agent", agentBody],
  ["GET", "/api/profile"],
  ["GET", "/api/conversations/latest"],
  ["GET", "/upload"],
  ["GET", "/dashboard"],
];
const expectedNoAccess = (path, r) => (path.startsWith("/api/") ? r.status === 401 : r.status === 307 && (r.headers.get("location") ?? "").includes("/login"));

// 1. Bez ciasteczek
for (const [method, path, body] of targets) {
  const r = await hit(path, { method, body });
  add("1. Bez ciasteczek", `${method} ${path}`, describe(r), expectedNoAccess(path, r) ? "ok" : "bad");
}

// 2. Zmyślone ciasteczko: fałszywy token (zły podpis), token „alg: none”, śmieci w ciasteczku, sam nagłówek Authorization
{
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: randomUUID(), email: "wlamywacz@example.com", role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now };
  const forgedHS = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.${b64url("zly-podpis-123")}`;
  const forgedNone = `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.`;
  const fakeSession = (token) => ({ access_token: token, refresh_token: "zmyslony", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: claims.sub, email: claims.email, aud: "authenticated", role: "authenticated" } });
  const variants = [
    ["fałszywy token (zły podpis)", sessionCookie(fakeSession(forgedHS))],
    ["token „alg: none” (bez podpisu)", sessionCookie(fakeSession(forgedNone))],
    ["śmieci w ciasteczku sesji", `${COOKIE_NAME}=to-nie-jest-sesja`],
    ["stare ciasteczko wspólnego hasła (amber_session)", "amber_session=1999999999.losowe.podpis"],
  ];
  for (const [label, cookie] of variants) {
    for (const [method, path, body] of [targets[0], targets[1], targets[3]]) {
      const r = await hit(path, { method, body, cookie });
      add("2. Zmyślone ciasteczko", `${label}: ${method} ${path}`, describe(r), expectedNoAccess(path, r) ? "ok" : "bad");
    }
  }
  const bearer = await hit("/api/profile", { headers: { authorization: `Bearer ${forgedHS}` } });
  add("2. Zmyślone ciasteczko", "nagłówek Authorization: Bearer <fałszywy token>", describe(bearer), bearer.status === 401 ? "ok" : "bad");
  const spoof = await hit("/api/profile", { headers: { "x-user-id": claims.sub, "x-forwarded-user": claims.email } });
  add("2. Zmyślone ciasteczko", "nagłówki x-user-id / x-forwarded-user", describe(spoof), spoof.status === 401 ? "ok" : "bad");
}

// 3. Sesja wygasła / unieważniona (prawdziwe konto tymczasowe)
const email = `amber.kurs.test.${Date.now()}@gmail.com`;
const password = `Test-${randomUUID()}`;
let userId = null;
{
  const b = makeBrowser();
  const { data, error } = await b.client.auth.signUp({ email, password });
  userId = data?.user?.id ?? null;
  if (error || !data.session) {
    add("3. Sesja wygasła", "założenie konta testowego", error?.code ?? "brak sesji", "bad", "dalsze próby z sesją pominięte");
  } else {
    const valid = await hit("/api/profile", { cookie: b.cookie() });
    add("3. Sesja wygasła", "kontrola: ważna sesja → GET /api/profile", describe(valid), valid.status === 200 ? "ok" : "bad");
    const session = data.session;
    const stolenCookie = b.cookie(); // „skradzione” ciasteczko sprzed wylogowania

    // 3a. token ze zmienioną datą wygaśnięcia (podpis już nie pasuje)
    const [h, p, s] = session.access_token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    const tampered = `${h}.${b64url({ ...payload, exp: payload.exp + 86400 * 365 })}.${s}`;
    const rT = await hit("/api/profile", { cookie: sessionCookie({ ...session, access_token: tampered }) });
    add("3. Sesja wygasła", "token z przedłużoną datą ważności (zmieniony exp)", describe(rT), rT.status === 401 ? "ok" : "bad");

    // 3b. wylogowanie, potem ponowne użycie starego ciasteczka (token jeszcze nie wygasł)
    await b.client.auth.signOut();
    const rOld = await hit("/api/profile", { cookie: stolenCookie });
    add("3. Sesja wygasła", "stare ciasteczko po wylogowaniu (token jeszcze ważny)", describe(rOld), rOld.status === 401 ? "ok" : "warn",
      rOld.status === 401 ? "" : "token JWT działa do wygaśnięcia (domyślnie 1 h), mimo wylogowania");
    const rOldPage = await hit("/upload", { cookie: stolenCookie });
    add("3. Sesja wygasła", "stare ciasteczko po wylogowaniu: strona /upload", describe(rOldPage), rOldPage.status === 307 ? "ok" : "warn");

    // 3c. sesja po terminie (expires_at w przeszłości) – serwer musi odświeżyć, a odświeżenie jest unieważnione
    const expired = sessionCookie({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 });
    const rExp = await hit("/api/profile", { cookie: expired });
    add("3. Sesja wygasła", "sesja po terminie + unieważnione odświeżanie", describe(rExp), rExp.status === 401 ? "ok" : "bad");
    const rExpAgent = await hit("/api/agent", { method: "POST", body: agentBody, cookie: expired });
    add("3. Sesja wygasła", "sesja po terminie: POST /api/agent", describe(rExpAgent), rExpAgent.status === 401 ? "ok" : "bad");
  }
}

// 4. „Endpoint obrazów” – obrazy generuje narzędzie w /api/agent (osobnego endpointu nie ma)
{
  const imageBody = {
    mode: "chat",
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Wygeneruj obraz: plakat z alarmem" }] }],
  };
  const r1 = await hit("/api/agent", { method: "POST", body: imageBody });
  add("4. Obrazy", "POST /api/agent z prośbą o obraz, bez sesji", describe(r1), r1.status === 401 ? "ok" : "bad");
  const photoBody = { mode: "chat", messages: [{ id: "u1", role: "user", parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" }, { type: "text", text: "Co to?" }] }] };
  const r2 = await hit("/api/agent", { method: "POST", body: photoBody });
  add("4. Obrazy", "POST /api/agent ze zdjęciem, bez sesji", describe(r2), r2.status === 401 ? "ok" : "bad");
  for (const path of ["/api/image", "/api/images", "/api/generate"]) {
    const r = await hit(path, { method: "POST", body: { prompt: "x" } });
    add("4. Obrazy", `POST ${path} (zgadywany adres)`, describe(r), r.status === 404 || r.status === 401 || r.status === 405 ? "ok" : "bad");
  }
  const rImg = await hit(`/_next/image?url=${encodeURIComponent("https://example.com/x.png")}&w=64&q=75`);
  add("4. Obrazy", "/_next/image z obcym adresem (pośrednik obrazów)", describe(rImg), rImg.status >= 400 ? "ok" : "bad");
}

// 5. Zmiana adresu powrotu po logowaniu (open redirect) – z PRAWDZIWĄ sesją, bo dopiero wtedy /login przekierowuje
{
  const b = makeBrowser();
  const { error } = await b.client.auth.signInWithPassword({ email, password });
  if (error) {
    add("5. Adres powrotu", "logowanie konta testowego", error.code ?? "błąd", "bad");
  } else {
    const evil = ["https://zla.strona", "//zla.strona", "/\\zla.strona", "%2F%2Fzla.strona", "javascript:alert(1)", "https:zla.strona", "/login?next=https://zla.strona"];
    for (const next of evil) {
      const r = await hit(`/login?next=${encodeURIComponent(next)}`, { cookie: b.cookie() });
      const loc = r.headers.get("location") ?? "";
      const internal = loc.startsWith(`${BASE}/`) || loc.startsWith("/");
      add("5. Adres powrotu", `/login?next=${next}`, describe(r), r.status === 307 && internal && !loc.includes("zla.strona") ? "ok" : "bad");
    }
    const good = await hit(`/login?next=${encodeURIComponent("/history")}`, { cookie: b.cookie() });
    add("5. Adres powrotu", "kontrola: /login?next=/history (adres wewnętrzny)", describe(good), (good.headers.get("location") ?? "").endsWith("/history") ? "ok" : "bad");
    const noSession = await hit(`/login?next=${encodeURIComponent("https://zla.strona")}`);
    add("5. Adres powrotu", "bez sesji: /login?next=https://zla.strona", describe(noSession), noSession.status === 200 ? "ok" : "bad");
    await b.client.auth.signOut();
  }
}

// 6. Obejście proxy (dodatkowo): inne zapisy adresu, nagłówek wewnętrzny Next.js
{
  const tricks = [
    ["/upload/", {}],
    ["/UPLOAD", {}],
    ["/%75pload", {}],
    ["/upload?x=1#a", {}],
    ["/upload (nagłówek x-middleware-subrequest)", { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" }],
    ["/dashboard (nagłówek x-middleware-subrequest)", { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }],
  ];
  for (const [label, headers] of tricks) {
    const path = label.split(" ")[0];
    const r = await hit(path, { headers });
    const ok = r.status === 307 || r.status === 308 || r.status === 404 || r.status === 401;
    add("6. Obejście proxy", label, describe(r), ok && r.status !== 200 ? "ok" : "bad");
  }
}

// Sprzątanie
if (userId && SB_SECRET) {
  const admin = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.deleteUser(userId);
  add("Sprzątanie", "usunięcie konta testowego", error ? "nie – usuń ręcznie w Supabase" : "usunięte", error ? "warn" : "ok");
}

const icon = { ok: "✅", warn: "⚠️", bad: "❌" };
let group = "";
for (const r of rows) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group}`);
  }
  console.log(`  ${icon[r.verdict]} ${r.attempt}\n       serwer: ${r.answer}${r.note ? `\n       uwaga: ${r.note}` : ""}`);
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\nRazem: ${count("ok")} poprawnie, ${count("warn")} do decyzji, ${count("bad")} niepoprawnie (z ${rows.length}).`);
