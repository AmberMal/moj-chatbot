// Testy Warsztatu 3 (etap 3): funkcje czatu w przeglądarce (lib/amber-chat-client.ts) – bez serwera.
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-ui.mjs

import {
  AGENT_API,
  IMAGE_REQUEST_PREFIX,
  MAX_IMAGE_DESCRIPTION_CHARS,
  STEP_LIMIT_MESSAGE,
  STOPPED_MESSAGE,
  STOPPED_TASK_NOTE,
  MAX_HISTORY_USER_TEXT_CHARS,
  markStoppedQuestion,
  stoppedQuestionId,
  buildImageRequest,
  canStop,
  stopNoteTarget,
  hasImageToolPart,
  hasVisibleContent,
  imageDownloadName,
  isStepLimit,
  prepareAgentMessages,
  readAnalysisResponse,
  readGeneratedImagePart,
} from "../lib/amber-chat-client.ts";
import { readFileSync } from "node:fs";
import { MAX_USER_MESSAGE_CHARS } from "../lib/amber-history.ts";
import { AMBER_CHAT_INSTRUCTIONS, AMBER_ANALYZE_INSTRUCTIONS } from "../lib/amber-instructions.ts";

let passed = 0;
let failed = 0;
function check(name, condition, info = "") {
  condition ? passed++ : failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${info ? `  → ${info}` : ""}`);
}

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const PHOTO = "data:image/jpeg;base64,/9j/4AAQ";
const signed = (id, text, extra = {}) => ({ id, role: "assistant", parts: [{ type: "text", text }], metadata: { kind: "chat", sig: "podpis", ...extra } });
const userMsg = (id, text, file) => ({ id, role: "user", parts: [{ type: "text", text }, ...(file ? [{ type: "file", mediaType: "image/jpeg", url: file }] : [])] });

console.log("\n=== Historia wysyłana do /api/agent ===");
check("Czat korzysta z /api/agent", AGENT_API === "/api/agent");
{
  const unsigned = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Przerwana odpowiedź" }] };
  const out = prepareAgentMessages([userMsg("u1", "A"), signed("a1", "Odp."), userMsg("u2", "B"), unsigned, userMsg("u3", "C")]);
  check("Odpowiedź Amber bez podpisu (np. po błędzie) jest pomijana", out.length === 4 && !out.some((m) => m.id === "a2"), out.map((m) => m.id).join(","));
  const empty = { id: "a3", role: "assistant", parts: [{ type: "text", text: "x" }], metadata: { kind: "chat", sig: "" } };
  check("Pusty podpis = brak podpisu → pomijana", prepareAgentMessages([userMsg("u1", "A"), empty, userMsg("u2", "B")]).length === 2);
  const v4 = { id: "a4", role: "assistant", parts: [{ type: "text", text: "Od £666" }], metadata: { category: "sales", priority: "normal", needs_review: false, sig: "s" } };
  check("Podpisana odpowiedź ze starego /api/chat (v4) zostaje", prepareAgentMessages([userMsg("u1", "A"), v4, userMsg("u2", "B")]).length === 3);
}
{
  const out = prepareAgentMessages([userMsg("u1", "Zdjęcie 1", PHOTO), signed("a1", "Widzę panel."), userMsg("u2", "Zdjęcie 2", PHOTO)]);
  check("Stare zdjęcie klienta wycięte (zostaje tekst)", out[0].parts.every((p) => p.type !== "file") && out[0].parts[0].text === "Zdjęcie 1");
  check("Najnowsze zdjęcie klienta zostaje", out[2].parts.some((p) => p.type === "file" && p.url === PHOTO));
  const onlyPhoto = prepareAgentMessages([{ id: "u1", role: "user", parts: [{ type: "file", mediaType: "image/jpeg", url: PHOTO }] }, signed("a1", "OK"), userMsg("u2", "Dalej")]);
  check("Stare zdjęcie bez tekstu → pusta część tekstowa", onlyPhoto[0].parts.length === 1 && onlyPhoto[0].parts[0].type === "text" && onlyPhoto[0].parts[0].text === "");
}
{
  const withImage = {
    id: "a1", role: "assistant", metadata: { kind: "chat", sig: "s", tools: ["generujObraz"] },
    parts: [
      { type: "step-start" },
      { type: "tool-generujObraz", toolCallId: "c1", state: "output-available", input: { opis: "plakat" }, output: { ok: true, image: IMG, model: "google/x" } },
      { type: "text", text: "Gotowe." },
    ],
  };
  const original = JSON.stringify(withImage);
  const out = prepareAgentMessages([userMsg("u1", "Plakat"), withImage, userMsg("u2", "Dzięki")]);
  const part = out[1].parts.find((p) => p.type === "tool-generujObraz");
  check("Wygenerowany obraz NIE wraca na serwer (zostaje tylko { ok: true })", JSON.stringify(part.output) === JSON.stringify({ ok: true }) && !JSON.stringify(out).includes(IMG));
  check("Tekst, identyfikator narzędzia i podpis bez zmian", out[1].parts[2].text === "Gotowe." && part.toolCallId === "c1" && out[1].metadata.sig === "s");
  check("Oryginalna wiadomość w oknie czatu nie jest zmieniana (obraz nadal widoczny)", JSON.stringify(withImage) === original);
  const failedImg = { ...withImage, parts: [{ type: "tool-generujObraz", toolCallId: "c2", state: "output-available", output: { ok: false, error: "Błąd" } }] };
  const out2 = prepareAgentMessages([userMsg("u1", "x"), failedImg, userMsg("u2", "y")]);
  check("Nieudany obraz → { ok: false }", JSON.stringify(out2[1].parts[0].output) === JSON.stringify({ ok: false }));
}

console.log("\n=== Obraz z narzędzia modelu w rozmowie ===");
check("W trakcie (input-available) → „Generuję obraz…”", readGeneratedImagePart({ type: "tool-generujObraz", state: "input-available" })?.status === "loading");
check("W trakcie (input-streaming) → „Generuję obraz…”", readGeneratedImagePart({ type: "tool-generujObraz", state: "input-streaming" })?.status === "loading");
{
  const v = readGeneratedImagePart({ type: "tool-generujObraz", state: "output-available", output: { ok: true, image: IMG, model: "google/gemini-3.1-flash-image-preview" } });
  check("Gotowy obraz → adres obrazu i model", v?.status === "done" && v.url === IMG && v.model === "google/gemini-3.1-flash-image-preview");
}
check("Błąd narzędzia → komunikat z serwera", readGeneratedImagePart({ type: "tool-generujObraz", state: "output-available", output: { ok: false, error: "Model nie wygenerował obrazu." } })?.error === "Model nie wygenerował obrazu.");
check("output-error → komunikat po polsku", readGeneratedImagePart({ type: "tool-generujObraz", state: "output-error", errorText: "x" })?.status === "error");
check("Adres inny niż data:image (np. https) → nie jest pokazywany jako obraz", readGeneratedImagePart({ type: "tool-generujObraz", state: "output-available", output: { ok: true, image: "https://evil.example/x.png" } })?.status === "error");
check("data:image/svg+xml → nie jest pokazywany", readGeneratedImagePart({ type: "tool-generujObraz", state: "output-available", output: { ok: true, image: "data:image/svg+xml;base64,PHN2Zz4=" } })?.status === "error");
check("Inna część (tekst) → null", readGeneratedImagePart({ type: "text", text: "x" }) === null);
check("Nazwa pliku do pobrania", imageDownloadName(IMG, new Date(2026, 10, 11, 15, 30)) === "amber-obraz-2026-11-11-1530.png");
check("Nazwa pliku JPG", imageDownloadName("data:image/jpeg;base64,AA", new Date(2026, 0, 2, 3, 4)) === "amber-obraz-2026-01-02-0304.jpg");

console.log("\n=== Limit kroków i analiza JSON ===");
check("finishReason „tool-calls” = limit 6 kroków", isStepLimit("tool-calls") && !isStepLimit("stop") && !isStepLimit(undefined));
check("Komunikat o limicie po polsku", STEP_LIMIT_MESSAGE.includes("limit 6 kroków"));
{
  const ok = readAnalysisResponse({ analysis: { category: "sales", priority: "normal", draft: "Od £666", needs_review: false }, model: "google/gemini-3.8-flash" });
  check("Poprawny wynik analizy → 4 pola i model", ok?.analysis.category === "sales" && ok.model === "google/gemini-3.8-flash");
  check("Wynik bez pola needs_review → odrzucony", readAnalysisResponse({ analysis: { category: "sales", priority: "normal", draft: "x" } }) === null);
  check("needs_review jako tekst → odrzucony", readAnalysisResponse({ analysis: { category: "sales", priority: "normal", draft: "x", needs_review: "false" } }) === null);
  check("Dodatkowe pola nie są pokazywane", JSON.stringify(Object.keys(readAnalysisResponse({ analysis: { category: "a", priority: "b", draft: "c", needs_review: true, send_now: true } }).analysis)) === JSON.stringify(["category", "priority", "draft", "needs_review"]));
  check("Brak wyniku → null", readAnalysisResponse(null) === null && readAnalysisResponse({}) === null);
}

console.log("\n=== Etap 4: przycisk „Wygeneruj obraz” → prośba do /api/agent ===");
check("Limit opisu = 500 znaków (jak w narzędziu)", MAX_IMAGE_DESCRIPTION_CHARS === 500);
check("Opis → wyraźna prośba „Proszę wygenerować obraz: …”", buildImageRequest("  Plakat z alarmem  ") === "Proszę wygenerować obraz: Plakat z alarmem");
check("Każda prośba z przycisku zaczyna się od tej samej wyraźnej formuły", buildImageRequest("x").startsWith(IMAGE_REQUEST_PREFIX));
check("Opis dokładnie 500 znaków → przyjęty", buildImageRequest("a".repeat(500)) !== null);
check("Opis 501 znaków → nic nie jest wysyłane", buildImageRequest("a".repeat(501)) === null);
check("Pusty opis → nic nie jest wysyłane", buildImageRequest("   ") === null);
check("Długość całej wiadomości mieści się w limicie 4000 znaków", buildImageRequest("a".repeat(500)).length <= 4000);
check("Odpowiedź z częścią generujObraz → rozpoznana",
  hasImageToolPart({ id: "a", role: "assistant", parts: [{ type: "tool-generujObraz", toolCallId: "c", state: "output-available" }] }));
check("Odpowiedź bez narzędzia → komunikat „Model nie wygenerował obrazu…”",
  !hasImageToolPart({ id: "a", role: "assistant", parts: [{ type: "text", text: "Nie mogę." }] }));

console.log("\n=== Etap 4: bez pustego dymka ===");
{
  const msg = (parts) => ({ id: "a", role: "assistant", parts });
  check("Sam start kroku → brak treści (zamiast dymka „Model pisze…”)", !hasVisibleContent(msg([{ type: "step-start" }])));
  check("Pusty tekst → brak treści", !hasVisibleContent(msg([{ type: "step-start" }, { type: "text", text: "  " }])));
  check("Narzędzie inne niż obraz (np. aktualnyCzas w trakcie) → brak treści", !hasVisibleContent(msg([{ type: "tool-aktualnyCzas", toolCallId: "c", state: "input-available" }])));
  check("Pierwsze słowa odpowiedzi → dymek widoczny", hasVisibleContent(msg([{ type: "text", text: "Dzień" }])));
  check("Generowanie obrazu (w trakcie) → dymek z „Generuję obraz…”", hasVisibleContent(msg([{ type: "tool-generujObraz", toolCallId: "c", state: "input-available" }])));
  check("Same źródła → dymek widoczny", hasVisibleContent(msg([{ type: "source-url", sourceId: "s", url: "https://example.org" }])));
}

console.log("\n=== Lekcja 4, Warsztat 2 (Fast): przycisk Stop ===");
{
  check("Komunikat dokładnie „Przerwane przez użytkownika”", STOPPED_MESSAGE === "Przerwane przez użytkownika");
  check("Stop widoczny tylko, gdy agent pracuje (submitted, streaming)", canStop("submitted") && canStop("streaming") && !canStop("ready") && !canStop("error"));
  const u1 = userMsg("u1", "Pogoda w Londynie?");
  const partial = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-pogoda", toolCallId: "c1", state: "input-available", input: { miasto: "Londyn" } }, { type: "text", text: "Sprawdzam pogo" }] };
  check("Komunikat pod częściową odpowiedzią Amber", JSON.stringify(stopNoteTarget(partial, [u1, partial])) === '{"kind":"assistant","id":"a1"}');
  check("Stop przed pierwszą treścią (odpowiedzi nie ma w rozmowie) → komunikat pod pytaniem klienta", JSON.stringify(stopNoteTarget({ id: "nowa", role: "assistant", parts: [] }, [signed("a0", "Dzień dobry"), u1])) === '{"kind":"user","id":"u1"}');
  check("Brak wiadomości → bez komunikatu", stopNoteTarget(undefined, []) === null);
  const history = prepareAgentMessages([u1, partial, userMsg("u2", "A jutro?")]);
  check("Częściowa (niepodpisana) odpowiedź nie wraca do serwera w historii", history.length === 2 && history.every((m) => m.role === "user") && !JSON.stringify(history).includes("Sprawdzam pogo"));
  const kept = prepareAgentMessages([userMsg("u0", "x"), signed("a0", "Odpowiedź"), u1, partial, userMsg("u2", "y")]);
  check("Wcześniejsze podpisane odpowiedzi zostają w historii", kept.length === 4 && kept[1].id === "a0");

  const ui = readFileSync(new URL("../app/chat.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  check("Czat: przycisk Stop tylko przy canStop(status), wywołuje stop() z useChat", /\{canStop\(status\) && \(\s*<button type="button" className="stop" onClick=\{\(\) => stop\(\)\}>\s*Stop\s*<\/button>/.test(ui) && /const \{ messages, sendMessage, status, error, clearError, stop, setMessages \} = useChat\(/.test(ui));
  check("Czat: onFinish z isAbort zapisuje, gdzie pokazać komunikat", ui.includes("if (isAbort) {") && ui.includes("stopNoteTarget(message, all)"));
  check("Czat: komunikat pod częściową odpowiedzią i pod pytaniem (gdy brak odpowiedzi)", (ui.match(/<small className="stopped-note">⏹ \{STOPPED_MESSAGE\}<\/small>/g) ?? []).length === 2);
  check("Czat: przerwana odpowiedź bez treści nadal widoczna (z komunikatem)", ui.includes("!hasVisibleContent(message) && !stoppedIds.includes(message.id)"));
  check("Czat: po przerwaniu prośby o obraz bez komunikatu „model nie wygenerował obrazu”", ui.includes("!isError && !isAbort && !hasImageToolPart(message)"));
  check("Style: przycisk Stop i komunikat", /\.composer button\.stop \{/.test(css) && /\.stopped-note \{/.test(css));
}

console.log("\n=== Lekcja 4, Warsztat 2 (Fast): notatka przy przerwanym pytaniu (rozwiązanie 2) ===");
{
  check("Notatka dokładnie „[Klient przerwał to zadanie przyciskiem Stop.]”", STOPPED_TASK_NOTE === "[Klient przerwał to zadanie przyciskiem Stop.]");
  check("Limit tekstu w historii = limit serwera (4000)", MAX_HISTORY_USER_TEXT_CHARS === MAX_USER_MESSAGE_CHARS);
  const u0 = userMsg("u0", "Dzień dobry");
  const a0 = signed("a0", "Dzień dobry, w czym mogę pomóc?");
  const u1 = userMsg("u1", "Pogoda w Londynie, Paryżu i Berlinie?");
  const partial = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-pogoda", toolCallId: "c1", state: "input-available", input: { miasto: "Londyn" } }] };
  const u2 = userMsg("u2", "Ile kosztuje alarm?");
  check("Pytanie przerwanego zadania = ostatnia wiadomość klienta", stoppedQuestionId([u0, a0, u1, partial]) === "u1" && stoppedQuestionId([u0, a0, u1]) === "u1" && stoppedQuestionId([]) === null);
  const marked = markStoppedQuestion([u0, a0, u1, partial], "u1");
  check("Oznaczenie tylko przerwanego pytania (metadata.przerwane), inne bez zmian", marked[2].metadata?.przerwane === true && marked[0] === u0 && marked[1] === a0 && marked[3] === partial);
  check("Oznaczenie nie zmienia treści pytania na ekranie", JSON.stringify(marked[2].parts) === JSON.stringify(u1.parts));
  const sent = prepareAgentMessages([...marked, u2]);
  const q = sent.find((m) => m.id === "u1");
  const qText = q.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  check("Historia: notatka na końcu przerwanego pytania", qText === "Pogoda w Londynie, Paryżu i Berlinie?\n\n[Klient przerwał to zadanie przyciskiem Stop.]", JSON.stringify(qText));
  check("Historia: pole „przerwane” nie trafia na serwer", !("metadata" in q) || !("przerwane" in (q.metadata ?? {})));
  check("Historia: częściowa odpowiedź pominięta, inne pytania bez notatki", !sent.some((m) => m.id === "a1") && !JSON.stringify(sent.filter((m) => m.id !== "u1")).includes("przerwał"));
  check("Historia: za każdym razem identyczna (zgodność podpisów)", JSON.stringify(prepareAgentMessages([...marked, u2])) === JSON.stringify(sent));
  const errored = prepareAgentMessages([u0, a0, u1, { id: "a1", role: "assistant", parts: [{ type: "text", text: "Częściowo" }] }, u2]);
  check("Odpowiedź bez podpisu po błędzie (bez Stop) → bez notatki", !JSON.stringify(errored).includes("przerwał"));
  const long = markStoppedQuestion([userMsg("L", "x".repeat(4000))], "L");
  const longText = prepareAgentMessages(long)[0].parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  check("Bardzo długie pytanie: z notatką mieści się w 4000 znaków", longText.length <= 4000 && longText.endsWith(STOPPED_TASK_NOTE), String(longText.length));
  const withPhoto = markStoppedQuestion([userMsg("P", "Co to za alarm?", PHOTO)], "P");
  const ph = prepareAgentMessages(withPhoto)[0];
  check("Przerwane pytanie ze zdjęciem: zdjęcie zostaje, notatka dopisana", ph.parts.some((p) => p.type === "file") && ph.parts.at(-1).text.endsWith(STOPPED_TASK_NOTE));

  const ui = readFileSync(new URL("../app/chat.tsx", import.meta.url), "utf8");
  check("Czat: po Stop oznaczenie pytania przez setMessages", ui.includes("const questionId = stoppedQuestionId(all);") && ui.includes("markStoppedQuestion(current, questionId)") && ui.includes("setMessagesRef.current = setMessages;"));
  check("Instrukcja: nie wracaj sam do przerwanych zadań, wznów tylko na wyraźną prośbę",
    AMBER_CHAT_INSTRUCTIONS.includes("Wiadomość klienta z notatką „[Klient przerwał to zadanie przyciskiem Stop.]” to zadanie przerwane przez klienta.") &&
    AMBER_CHAT_INSTRUCTIONS.includes("Nie wykonuj go ponownie i nie wracaj do niego z własnej inicjatywy") &&
    AMBER_CHAT_INSTRUCTIONS.includes("Wznów przerwane zadanie wyłącznie wtedy, gdy klient wyraźnie o to poprosi.") &&
    !AMBER_ANALYZE_INSTRUCTIONS.includes("przyciskiem Stop"));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
