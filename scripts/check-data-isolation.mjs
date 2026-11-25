// Lekcja 7, Warsztat 2 (Standard): czy konto B dostanie się do danych konta A? – na DZIAŁAJĄCYM serwerze.
// Uruchamianie (okno poleceń, przy działającym npm run dev):
//   node --experimental-strip-types scripts/check-data-isolation.mjs
// Zakłada DWA TYMCZASOWE konta (A i B), konto A tworzy rozmowę, profil i dokument, a konto B próbuje je
// odczytać, zmienić i usunąć – przez endpointy aplikacji i bezpośrednio przez bazę (klucz publishable, jak w przeglądarce).
// Na końcu oba konta są usuwane razem z ich danymi (on delete cascade). Wartości z .env.local nie są wypisywane.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

process.loadEnvFile(".env.local");
const BASE = process.argv[2] ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SB_SECRET = process.env.SUPABASE_SECRET_KEY;
if (!SB_URL || !SB_KEY || !SB_SECRET) {
  console.log("Brak zmiennych Supabase w .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY).");
  process.exit(1);
}

const rows = [];
const add = (group, attempt, answer, verdict, note = "") =>
  rows.push({ group, attempt, answer: String(answer), verdict: verdict === true ? "ok" : verdict === false ? "bad" : verdict, note });

function makeBrowser() {
  const jar = new Map();
  const client = createServerClient(SB_URL, SB_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value, options }) => (value && options?.maxAge !== 0 ? jar.set(name, value) : jar.delete(name))),
    },
  });
  return { client, cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
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

const admin = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const SECRET_A = `TAJNE-A-${randomUUID().slice(0, 8)}`; // znacznik treści konta A – nie może pojawić się u B
async function newAccount(label) {
  const b = makeBrowser();
  const email = `amber.kurs.test.${label}.${stamp}@gmail.com`;
  const { data, error } = await b.client.auth.signUp({ email, password: `Test-${randomUUID()}` });
  if (error || !data.session) throw new Error(`Nie udało się założyć konta ${label}: ${error?.code ?? "brak sesji (Confirm email?)"}`);
  return { ...b, id: data.user.id };
}

let A, B;
try {
  A = await newAccount("a");
  B = await newAccount("b");

  // --- Konto A: profil, rozmowa, dokument ---
  const pA = await hit("/api/profile", { method: "PATCH", cookie: A.cookie(), body: { imie: "Alicja", preferencje: { miasto: "Kraków" } } });
  const { data: conv, error: convErr } = await A.client.from("conversations").insert({ title: `Rozmowa A ${SECRET_A}` }).select("id, user_id").single();
  if (convErr) throw new Error(`A: rozmowa – ${convErr.message}`);
  const { error: msgErr } = await A.client.from("messages").insert([
    { conversation_id: conv.id, role: "user", content: `Pytanie A ${SECRET_A}` },
    { conversation_id: conv.id, role: "assistant", content: `Odpowiedź A ${SECRET_A}` },
  ]);
  if (msgErr) throw new Error(`A: wiadomości – ${msgErr.message}`);
  const { data: doc, error: docErr } = await A.client.from("documents").insert({ title: `Dokument A ${SECRET_A}` }).select("id").single();
  if (docErr) throw new Error(`A: dokument – ${docErr.message}`);
  const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  const { error: chErr } = await A.client.from("chunks").insert({ document_id: doc.id, chunk_index: 0, content: `Fragment A ${SECRET_A}`, embedding: vector });
  if (chErr) throw new Error(`A: fragment – ${chErr.message}`);
  add("0. Przygotowanie (konto A)", "profil, rozmowa, dokument konta A", `profil ${pA.status}, rozmowa ${conv.id}`, pA.status === 200 && conv.user_id === A.id ? "ok" : "bad",
    conv.user_id === A.id ? "user_id wpisany przez bazę = konto A" : "user_id nie jest kontem A!");

  const leak = async (r) => (await r.text()).includes(SECRET_A);

  // --- 1. Konto B przez endpointy aplikacji (identyfikator rozmowy konta A) ---
  {
    const r = await hit(`/api/conversations/${conv.id}`, { cookie: B.cookie() });
    const text = await r.text();
    add("1. B przez endpointy", `GET /api/conversations/${conv.id} (rozmowa A)`, `${r.status} „${text.slice(0, 40)}”`, r.status === 404 && !text.includes(SECRET_A) ? "ok" : "bad");
  }
  {
    const r = await hit(`/api/conversations/${conv.id}`, { method: "DELETE", cookie: B.cookie() });
    const text = await r.text();
    const still = await hit(`/api/conversations/${conv.id}`, { cookie: A.cookie() });
    add("1. B przez endpointy", `DELETE /api/conversations/${conv.id}`, `${r.status} „${text.slice(0, 40)}”; u A nadal: ${still.status}`, r.status === 404 && still.status === 200 ? "ok" : "bad");
  }
  {
    const body = { mode: "chat", conversationId: conv.id, messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Dopisuję do cudzej rozmowy" }] }] };
    const r = await hit("/api/agent", { method: "POST", cookie: B.cookie(), body });
    const text = await r.text();
    add("1. B przez endpointy", `POST /api/agent z conversationId=${conv.id} (zapis)`, `${r.status} „${text.slice(0, 40)}”`, r.status === 404 && !text.includes(SECRET_A) ? "ok" : "bad", "404 zanim wywołany zostanie model");
  }
  {
    const r = await hit("/api/conversations/latest", { cookie: B.cookie() });
    const text = await r.text();
    let id = "?";
    try { id = JSON.parse(text).conversationId; } catch {}
    add("1. B przez endpointy", "GET /api/conversations/latest", `${r.status}, conversationId=${id}`, r.status === 200 && id !== conv.id && !text.includes(SECRET_A) ? "ok" : "bad");
  }
  {
    const r = await hit("/api/profile", { cookie: B.cookie() });
    const text = await r.text();
    add("1. B przez endpointy", "GET /api/profile (powitanie)", `${r.status}, ${text.includes("Alicja") ? "imię A!" : "bez imienia A"}`, r.status === 200 && !text.includes("Alicja") && !text.includes("Kraków") ? "ok" : "bad");
  }
  {
    const r = await hit("/api/profile", { method: "PATCH", cookie: B.cookie(), body: { imie: "Bartek" } });
    const a = await (await hit("/api/profile", { cookie: A.cookie() })).json();
    add("1. B przez endpointy", "PATCH /api/profile jako B", `${r.status}; profil A: ${a?.profile?.name}`, r.status === 200 && a?.profile?.name === "Alicja" ? "ok" : "bad", "B zmienia tylko swój profil");
    add("1. B przez endpointy", "Powitanie A po zmianie B", (a?.greeting ?? "").slice(0, 30), (a?.greeting ?? "").includes("Alicja") ? "ok" : "bad");
  }
  {
    const r = await hit("/api/upload", { cookie: B.cookie() });
    const leaked = await leak(r);
    add("1. B przez endpointy", "GET /api/upload (lista dokumentów)", `${r.status}, ${leaked ? "widzi dokument A!" : "bez dokumentu A"}`, r.status === 200 && !leaked ? "ok" : "bad");
  }
  {
    const r = await hit("/api/upload", { method: "DELETE", cookie: B.cookie(), body: { id: doc.id } });
    const { data: still } = await A.client.from("documents").select("id").eq("id", doc.id);
    add("1. B przez endpointy", `DELETE /api/upload id=${doc.id} (dokument A)`, `${r.status}; u A nadal: ${still?.length ? "tak" : "NIE"}`, r.status === 404 && still?.length === 1 ? "ok" : "bad");
  }
  {
    const r = await hit(`/?c=${conv.id}`, { cookie: B.cookie() });
    const html = await r.text();
    add("1. B przez endpointy", `strona /?c=${conv.id}`, `${r.status}, ${html.includes(SECRET_A) ? "dane A w HTML!" : "bez danych A"}`, r.status === 200 && !html.includes(SECRET_A) ? "ok" : "bad", "czat sam pokazuje „Nie znaleziono” po wczytaniu");
  }

  // --- 2. Konto B bezpośrednio przez bazę (klucz publishable + sesja B – to samo może zrobić przeglądarka) ---
  {
    const { data } = await B.client.from("conversations").select("id, title").eq("id", conv.id);
    add("2. B bezpośrednio w bazie", "SELECT rozmowy A", `${data?.length ?? 0} wierszy`, (data?.length ?? 0) === 0 ? "ok" : "bad");
    const { data: msgs } = await B.client.from("messages").select("id").eq("conversation_id", conv.id);
    add("2. B bezpośrednio w bazie", "SELECT wiadomości A", `${msgs?.length ?? 0} wierszy`, (msgs?.length ?? 0) === 0 ? "ok" : "bad");
    const { data: upd } = await B.client.from("conversations").update({ title: "przejęte" }).eq("id", conv.id).select("id");
    add("2. B bezpośrednio w bazie", "UPDATE tytułu rozmowy A", `${upd?.length ?? 0} zmienionych`, (upd?.length ?? 0) === 0 ? "ok" : "bad");
    const { data: del } = await B.client.from("conversations").delete().eq("id", conv.id).select("id");
    add("2. B bezpośrednio w bazie", "DELETE rozmowy A", `${del?.length ?? 0} usuniętych`, (del?.length ?? 0) === 0 ? "ok" : "bad");
    const { error: steal } = await B.client.from("conversations").insert({ title: "podszywam się", user_id: A.id });
    add("2. B bezpośrednio w bazie", "INSERT rozmowy z user_id konta A", steal ? `odmowa (${steal.code})` : "przyjęte!", steal ? "ok" : "bad");
    const { data: prof } = await B.client.from("user_profiles").select("name");
    add("2. B bezpośrednio w bazie", "SELECT profili", `${(prof ?? []).map((p) => p.name).join(", ") || "brak"}`, !(prof ?? []).some((p) => p.name === "Alicja") ? "ok" : "bad");
    const { data: docs } = await B.client.from("documents").select("id").eq("id", doc.id);
    add("2. B bezpośrednio w bazie", "SELECT dokumentu A", `${docs?.length ?? 0} wierszy`, (docs?.length ?? 0) === 0 ? "ok" : "bad");
    const { data: found, error: rpcErr } = await B.client.rpc("match_chunks", { query_embedding: vector, match_count: 5 });
    const leaked = (found ?? []).some((f) => String(f.content).includes(SECRET_A));
    add("2. B bezpośrednio w bazie", "match_chunks (wyszukiwanie) jako B", rpcErr ? `błąd ${rpcErr.code}` : `${found.length} fragmentów, ${leaked ? "fragment A!" : "bez fragmentu A"}`, !rpcErr && !leaked ? "ok" : "bad");
    const { data: foundA } = await A.client.rpc("match_chunks", { query_embedding: vector, match_count: 5 });
    add("2. B bezpośrednio w bazie", "kontrola: match_chunks jako A", `${(foundA ?? []).length} fragmentów`, (foundA ?? []).some((f) => String(f.content).includes(SECRET_A)) ? "ok" : "bad");
    // Dopisanie własnego wiersza do CUDZEJ rozmowy / cudzego dokumentu (polityka sprawdza tylko user_id wiersza)
    const { error: injMsg } = await B.client.from("messages").insert({ conversation_id: conv.id, role: "user", content: "wiadomość B w rozmowie A" });
    add("2. B bezpośrednio w bazie", "INSERT własnej wiadomości do rozmowy A", injMsg ? `odmowa (${injMsg.code})` : "przyjęte", injMsg ? "ok" : "warn",
      injMsg ? "" : "A tego nie widzi (RLS), ale wiersz siedzi w rozmowie A – polityka nie sprawdza właściciela rozmowy");
    const { error: injChunk } = await B.client.from("chunks").insert({ document_id: doc.id, chunk_index: 99, content: "fragment B w dokumencie A" });
    add("2. B bezpośrednio w bazie", "INSERT własnego fragmentu do dokumentu A", injChunk ? `odmowa (${injChunk.code})` : "przyjęte", injChunk ? "ok" : "warn",
      injChunk ? "" : "jak wyżej – polityka nie sprawdza właściciela dokumentu");
    const { data: aMsgs } = await A.client.from("messages").select("content").eq("conversation_id", conv.id);
    add("2. B bezpośrednio w bazie", "kontrola: co widzi A w swojej rozmowie", `${aMsgs?.length ?? 0} wiadomości`, (aMsgs ?? []).every((m) => !m.content.includes("wiadomość B")) ? "ok" : "bad");
  }

  // --- 3. Wspólna baza wiedzy firmy (kolumna documents.wspolny – ustawia ją tylko panel Supabase) ---
  {
    const SHARED = `WSPOLNY-${randomUUID().slice(0, 8)}`;
    const { data: sdoc, error: sdErr } = await A.client.from("documents").insert({ title: `Wspólny A ${SHARED}` }).select("id").single();
    if (sdErr) throw new Error(`A: wspólny dokument – ${sdErr.message}`);
    const svec = Array.from({ length: 1536 }, (_, i) => (i === 1 ? 1 : 0));
    await A.client.from("chunks").insert({ document_id: sdoc.id, chunk_index: 0, content: `Fragment wspólny ${SHARED}`, embedding: svec });
    const { error: markErr } = await admin.from("documents").update({ wspolny: true }).eq("id", sdoc.id);
    add("3. Wspólna baza firmy", "oznaczenie dokumentu A jako wspólny (panel/administrator)", markErr ? `błąd (${markErr.code})` : "OK", !markErr, markErr ? "uruchom najpierw SQL z kolumną wspolny" : "");
    const { data: bSee } = await B.client.from("documents").select("id").eq("id", sdoc.id);
    add("3. Wspólna baza firmy", "B czyta wspólny dokument", `${bSee?.length ?? 0} wierszy`, (bSee?.length ?? 0) === 1);
    const { data: bFound } = await B.client.rpc("match_chunks", { query_embedding: svec, match_count: 3 });
    add("3. Wspólna baza firmy", "B znajduje wspólny fragment (searchKnowledge)", (bFound ?? []).some((f) => String(f.content).includes(SHARED)) ? "tak" : "nie", (bFound ?? []).some((f) => String(f.content).includes(SHARED)));
    const { data: bUpd } = await B.client.from("documents").update({ title: "przejęte" }).eq("id", sdoc.id).select("id");
    add("3. Wspólna baza firmy", "B zmienia wspólny dokument", `${bUpd?.length ?? 0} zmienionych`, (bUpd?.length ?? 0) === 0);
    const { data: bDel } = await B.client.from("documents").delete().eq("id", sdoc.id).select("id");
    add("3. Wspólna baza firmy", "B usuwa wspólny dokument", `${bDel?.length ?? 0} usuniętych`, (bDel?.length ?? 0) === 0);
    const { data: cUpd } = await B.client.from("chunks").update({ content: "przejęte" }).eq("document_id", sdoc.id).select("id");
    add("3. Wspólna baza firmy", "B zmienia wspólny fragment", `${cUpd?.length ?? 0} zmienionych`, (cUpd?.length ?? 0) === 0);
    const { error: bIns } = await B.client.from("documents").insert({ title: "podrzucam wszystkim", wspolny: true });
    add("3. Wspólna baza firmy", "B dodaje własny dokument jako wspólny", bIns ? `odmowa (${bIns.code})` : "PRZYJĘTE", Boolean(bIns));
    const { data: bOwn } = await B.client.from("documents").insert({ title: `Własny B ${SHARED}` }).select("id").single();
    const { error: bMark } = bOwn ? await B.client.from("documents").update({ wspolny: true }).eq("id", bOwn.id) : { error: { code: "brak" } };
    add("3. Wspólna baza firmy", "B oznacza swój dokument jako wspólny", bMark ? `odmowa (${bMark.code})` : "PRZYJĘTE", Boolean(bMark));
    const rList = await hit("/api/upload", { cookie: B.cookie() });
    const listText = await rList.text();
    add("3. Wspólna baza firmy", "lista /upload u B (tylko własne)", `${rList.status}, ${listText.includes(SHARED) && listText.includes("Wspólny A") ? "widzi wspólny dokument A" : "bez dokumentu A"}`, rList.status === 200 && !listText.includes("Wspólny A"));
  }
} catch (error) {
  add("Błąd", "przerwano sprawdzanie", error instanceof Error ? error.message : String(error), "bad");
} finally {
  for (const acc of [A, B]) {
    if (!acc) continue;
    const { error } = await admin.auth.admin.deleteUser(acc.id);
    add("Sprzątanie", `usunięcie konta testowego ${acc === A ? "A" : "B"} (z danymi)`, error ? "nie – usuń ręcznie" : "usunięte", error ? "warn" : "ok");
  }
}

const icon = { ok: "✅", warn: "⚠️", bad: "❌" };
let group = "";
for (const r of rows) {
  if (r.group !== group) console.log(`\n${(group = r.group)}`);
  console.log(`  ${icon[r.verdict]} ${r.attempt}\n       wynik: ${r.answer}${r.note ? `\n       uwaga: ${r.note}` : ""}`);
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\nRazem: ${count("ok")} poprawnie, ${count("warn")} do decyzji, ${count("bad")} niepoprawnie (z ${rows.length}).`);
