// Lekcja 7: konta przez Supabase Auth – komunikaty, kolejność „najpierw użytkownik”, pliki.
// Uruchamianie: node --experimental-strip-types scripts/test-amber-auth.mjs
import { readFileSync, existsSync } from "node:fs";
import { AUTH_MESSAGES, AUTH_MIN_PASSWORD, authErrorMessage, isExistingAccountSignup, validateAuthInput } from "../lib/amber-auth-messages.ts";
import { afterLoginPath, loginUrl, safeNextPath } from "../lib/amber-auth-redirect.ts";
import { createAgentHandler } from "../lib/amber-agent.ts";
import { createLatestConversationHandler, createConversationByIdHandler, createDeleteConversationHandler } from "../lib/amber-conversations.ts";
import { createProfileApi } from "../lib/amber-profile.ts";
import { createUploadApi } from "../lib/amber-knowledge.ts";
import { createDashboardHandler } from "../lib/amber-dashboard.ts";

let ok = 0, bad = 0;
function check(name, cond, extra = "") {
  if (cond) { ok++; console.log(`✅ ${name}`); } else { bad++; console.log(`❌ NIE: ${name} ${extra}`); }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("\n=== 1. Komunikaty po polsku ===");
check("Minimum hasła = 8", AUTH_MIN_PASSWORD === 8);
check("Za krótkie hasło przy zakładaniu konta", validateAuthInput("a@b.pl", "1234567", "signup") === AUTH_MESSAGES.shortPassword);
check("8 znaków przy zakładaniu konta – OK", validateAuthInput("a@b.pl", "12345678", "signup") === null);
check("Pusty e-mail", validateAuthInput(" ", "12345678", "login") === AUTH_MESSAGES.emptyEmail);
check("Zły e-mail", validateAuthInput("malwina", "12345678", "login") === AUTH_MESSAGES.badEmail);
check("Puste hasło", validateAuthInput("a@b.pl", "", "login") === AUTH_MESSAGES.emptyPassword);
check("Złe hasło (invalid_credentials)", authErrorMessage({ code: "invalid_credentials" }, "login") === AUTH_MESSAGES.wrongPassword);
check("Konto już istnieje (user_already_exists)", authErrorMessage({ code: "user_already_exists" }, "signup") === AUTH_MESSAGES.accountExists);
check("Konto już istnieje (email_exists)", authErrorMessage({ code: "email_exists" }, "signup") === AUTH_MESSAGES.accountExists);
check("Za krótkie hasło (weak_password z Supabase)", authErrorMessage({ code: "weak_password" }, "signup") === AUTH_MESSAGES.shortPassword);
check("Rejestracja na istniejący adres (identities = []) → konto już istnieje", isExistingAccountSignup({ identities: [] }) === true &&
  isExistingAccountSignup({ identities: [{ id: "x" }] }) === false && isExistingAccountSignup(null) === false && isExistingAccountSignup({}) === false);
check("Formularz rozpoznaje istniejące konto przed komunikatem o potwierdzeniu", read("app/login/auth-form.tsx").indexOf("isExistingAccountSignup(data.user)") > 0 &&
  read("app/login/auth-form.tsx").indexOf("isExistingAccountSignup(data.user)") < read("app/login/auth-form.tsx").indexOf("AUTH_MESSAGES.checkEmail"));
check("Nieznany błąd – ogólny komunikat", authErrorMessage({ code: "x" }, "login") === AUTH_MESSAGES.loginFailed && authErrorMessage(null, "signup") === AUTH_MESSAGES.signupFailed);
check("Komunikaty bez angielskich tekstów Supabase", !Object.values(AUTH_MESSAGES).some((m) => /invalid|credentials|already registered/i.test(m)));

console.log("\n=== 2. Bez użytkownika 401 – zanim baza albo model (sesja asynchroniczna) ===");
const counter = { db: 0, model: 0 };
const noUser = async () => null;
const store = () => { counter.db++; return null; };
const req = (url, method = "GET", body) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const agent = createAgentHandler({
  getSession: noUser,
  createModels: () => { counter.model++; return null; },
  instructions: { chat: "", analyze: "" },
  history: { deriveHistoryKey: () => Buffer.alloc(32), sessionIdFromToken: (t) => t, checkChatHistory: () => ({ ok: true, turns: [] }), signAgentChatTurn: () => "" },
  generateAmberOutput: async () => { counter.model++; return null; },
  maxTextChars: 4000,
  conversations: store,
  log: () => {},
});
check("/api/agent (chat) → 401", (await agent(req("/api/agent", "POST", { mode: "chat", messages: [] }))).status === 401);
check("/api/agent (analyze) → 401", (await agent(req("/api/agent", "POST", { mode: "analyze", text: "x" }))).status === 401);
const conv = { getSession: noUser, getStore: store, sign: () => "" };
check("/api/conversations/latest → 401", (await createLatestConversationHandler(conv)(req("/api/conversations/latest"))).status === 401);
check("/api/conversations/[id] GET → 401", (await createConversationByIdHandler(conv)(req("/api/conversations/1"), "1")).status === 401);
check("/api/conversations/[id] DELETE → 401", (await createDeleteConversationHandler(conv)(req("/api/conversations/1", "DELETE"), "1")).status === 401);
const profile = createProfileApi({ getSession: noUser, getStore: store });
check("/api/profile GET, PATCH, DELETE → 401", (await profile.GET(req("/api/profile"))).status === 401 &&
  (await profile.PATCH(req("/api/profile", "PATCH", { imie: "x" }))).status === 401 && (await profile.DELETE(req("/api/profile", "DELETE", { wszystko: true }))).status === 401);
const upload = createUploadApi({ getSession: noUser, getStore: store });
check("/api/upload GET, POST, DELETE → 401", (await upload.GET(req("/api/upload"))).status === 401 &&
  (await upload.POST(req("/api/upload", "POST", { tytul: "x", tekst: "y" }))).status === 401 && (await upload.DELETE(req("/api/upload", "DELETE", { id: 1 }))).status === 401);
const dash = createDashboardHandler({ hasSession: async () => false, sources: {}, summarize: null, recommend: null, log: () => {} });
check("/api/dashboard → 401", (await dash(req("/api/dashboard", "POST", { miasto: "Londyn" }))).status === 401);
check("Ani razu baza, ani razu model", counter.db === 0 && counter.model === 0, JSON.stringify(counter));

console.log("\n=== 3. Pliki ===");
const routes = ["app/api/agent/route.ts", "app/api/conversations/latest/route.ts", "app/api/conversations/[id]/route.ts", "app/api/profile/route.ts", "app/api/upload/route.ts", "app/api/dashboard/route.ts"];
check("Każdy endpoint: użytkownik z lib/auth (getApiSession / getCurrentUser)", routes.every((r) => /getApiSession\(\)|getCurrentUser\(\)/.test(read(r))));
check("Żaden endpoint nie bierze użytkownika z formularza ani adresu", routes.every((r) => !/userId|user_id|searchParams\.get\("user/.test(read(r))));
const auth = read("lib/auth.ts");
check("Serwer weryfikuje sesję przez getClaims (nie getSession)", auth.includes("supabase.auth.getClaims()") && !auth.includes("auth.getSession("));
check("Proxy: getClaims, plik proxy.ts z funkcją proxy", read("lib/supabase-auth/proxy.ts").includes("auth.getClaims()") && read("proxy.ts").includes("export async function proxy"));
check("Brak middleware.ts (Next.js 16 – proxy.ts)", !existsSync(new URL("../middleware.ts", import.meta.url)));
const pages = ["app/page.tsx", "app/history/page.tsx", "app/profile/page.tsx", "app/upload/page.tsx", "app/dashboard/page.tsx"];
check("Strony: bez logowania redirect na /login i dynamiczne", pages.every((p) => read(p).includes('if (!user) redirect(loginUrl(') && read(p).includes('export const dynamic = "force-dynamic"')));
check("/login dynamiczna, zakładki „Zaloguj się” i „Załóż konto”", read("app/login/page.tsx").includes('export const dynamic = "force-dynamic"') &&
  read("app/login/auth-form.tsx").includes("Zaloguj się") && read("app/login/auth-form.tsx").includes("Załóż konto"));
check("Czat: e-mail i „Wyloguj” przez Supabase", read("app/chat.tsx").includes("user-email") && read("app/chat.tsx").includes("Wyloguj") && read("app/chat.tsx").includes("auth.signOut()"));
check("Wspólne hasło usunięte", !existsSync(new URL("../app/api/login/route.ts", import.meta.url)) && !existsSync(new URL("../app/login-form.tsx", import.meta.url)) &&
  ![...routes, ...pages, "lib/auth.ts"].some((p) => /CHAT_PASSWORD|SESSION_SECRET|SESSION_COOKIE/.test(read(p))));
check("Przeglądarka dostaje tylko klucz publishable (bez SUPABASE_SECRET_KEY)", !read("lib/supabase-auth/config.ts").includes("SECRET") && !read("app/login/auth-form.tsx").includes("SECRET"));

console.log("\n=== 4. Standard: powrót po zalogowaniu (tylko adresy wewnątrz aplikacji) ===");
check("/upload → zapamiętany", safeNextPath("/upload") === "/upload" && loginUrl("/upload") === "/login?next=%2Fupload");
check("Parametry zostają (/?c=12)", safeNextPath("/?c=12") === "/?c=12");
check("Strona główna bez parametru", loginUrl("/") === "/login");
check("Obca strona odrzucona (https://, //, \\, javascript:)", ["https://zla.strona", "//zla.strona", "/\\zla.strona", "javascript:alert(1)", "http:/zla"].every((v) => safeNextPath(v) === null));
check("Znaki sterujące i za długi adres odrzucone", safeNextPath("/a\nb") === null && safeNextPath("/" + "a".repeat(600)) === null);
check("Nie wracamy na /login ani do /api", safeNextPath("/login") === null && safeNextPath("/login?next=/x") === null && safeNextPath("/api/agent") === null);
check("afterLoginPath: zły albo brak → czat", afterLoginPath(undefined) === "/" && afterLoginPath("https://zla.strona") === "/" && afterLoginPath(["/history", "/x"]) === "/history");
const proxyFile = read("lib/supabase-auth/proxy.ts");
check("Proxy dopisuje next przez safeNextPath", proxyFile.includes("safeNextPath(") && proxyFile.includes('searchParams.set("next", next)'));
const loginPage = read("app/login/page.tsx");
check("/login: next tylko przez afterLoginPath, zalogowany → redirect(next)", loginPage.includes("afterLoginPath(") && loginPage.includes("redirect(next)"));
const form = read("app/login/auth-form.tsx");
check("Formularz: po zalogowaniu window.location.replace(next)", form.includes("window.location.replace(next)"));
check("Formularz: w trakcie zablokowane przyciski i pola, „Chwileczkę…”", form.includes("Chwileczkę…") && (form.match(/disabled=\{pending\}/g) ?? []).length >= 5);

console.log("\n=== 5. Standard: wylogowanie i „Wstecz” ===");
const chatFile = read("app/chat.tsx");
const logout = chatFile.slice(chatFile.indexOf("async function handleLogout"), chatFile.indexOf("async function handleLogout") + 700);
check("Wyloguj: czyści rozmowę, analizy i powitanie przed wylogowaniem", ["setMessages([])", "setAnalyses([])", "setGreeting(null)"].every((t) => logout.includes(t)) && logout.indexOf("setMessages([])") < logout.indexOf("signOut()"));
check("Wyloguj: pełne przejście location.replace(\"/login\")", logout.includes('window.location.replace("/login")'));
check("Strażnik „Wstecz” w layout (pageshow + persisted → reload)", read("app/layout.tsx").includes("<BackForwardGuard />") &&
  read("app/back-forward-guard.tsx").includes("event.persisted") && read("app/back-forward-guard.tsx").includes("window.location.reload()"));

console.log("\n=== 6. Warsztat 2: dane każdej osoby osobno (RLS) ===");
const supa = read("lib/supabase.ts");
const userPart = supa.slice(supa.indexOf("export function createUserStores"));
check("Rozmowy i profil: klient zalogowanej osoby (createSupabaseServerClient), nie klucz secret", userPart.includes("createSupabaseServerClient()") && !userPart.includes("getSupabase()"));
check("Standard: baza wiedzy i searchKnowledge też klientem zalogowanej osoby", userPart.includes("createKnowledgeStore(createSupabaseKnowledgeDb(userClient)") && userPart.includes("createSupabaseMatchChunks(userClient)") &&
  !/getKnowledgeStore|getSearchKnowledgeTool/.test(supa) && read("app/api/upload/route.ts").includes("getUserKnowledgeStore") && read("app/upload/page.tsx").includes("getUserKnowledgeStore"));
check("Stare magazyny na kluczu secret usunięte", !supa.includes("export function getConversationStore") && !supa.includes("export function getProfileStore"));
const convFile = read("lib/amber-conversations.ts"), profFile = read("lib/amber-profile.ts");
check("Aplikacja nie wysyła user_id (wpisuje go baza)", !/user_id/.test(convFile) && !/user_id/.test(profFile));
const agentRouteFile = read("app/api/agent/route.ts");
check("Agent: zapiszProfil, profil w instrukcjach i zapis rozmów – magazyny zalogowanej osoby",
  agentRouteFile.includes("createUserStores(await createSupabaseServerClient())") && agentRouteFile.includes("createProfileTool(profileStore)") &&
  agentRouteFile.includes("const store = userStores.profile") && agentRouteFile.includes("conversations: () => userStores.conversations"));
check("Endpointy i strony: getUserConversationStore / getUserProfileStore", ["app/api/conversations/latest/route.ts", "app/api/conversations/[id]/route.ts", "app/history/page.tsx"].every((f) => read(f).includes("getUserConversationStore")) &&
  ["app/api/profile/route.ts", "app/profile/page.tsx"].every((f) => read(f).includes("getUserProfileStore")));
check("Nikt nie bierze user_id z zapytania ani od modelu", [...routes, "app/history/page.tsx", "app/profile/page.tsx", "lib/amber-profile.ts"].every((f) => !/body\.user_id|userId\s*[:=]\s*body|input\.user_id/.test(read(f))));
{
  const calls = [];
  const order = createProfileApi({ getSession: async () => { calls.push("sesja"); return null; }, getStore: async () => { calls.push("baza"); return null; } });
  await order.GET(req("/api/profile"));
  check("Asynchroniczny magazyn: najpierw sesja, bez niej baza nie jest otwierana", calls.join(",") === "sesja");
}

console.log(`\nWynik: ${ok} zaliczonych, ${bad} niezaliczonych.`);
process.exitCode = bad === 0 ? 0 : 1;
