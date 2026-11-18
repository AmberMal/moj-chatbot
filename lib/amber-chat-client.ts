// Warsztat 3: pomocnicze funkcje czatu w przeglądarce (app/chat.tsx) dla /api/agent.
// Bez sekretów i bez dostępu do serwera – tylko przygotowanie historii i odczyt części wiadomości.

import type { UIMessage } from "ai";

export const AGENT_API = "/api/agent";
// Pokazywany tylko wtedy, gdy odpowiedź po limicie kroków nie ma tekstu (np. przerwana) –
// zwykle podsumowanie „Zatrzymałem się po 6 krokach” dopisuje serwer.
export const STEP_LIMIT_MESSAGE =
  "Osiągnięto limit 6 kroków – odpowiedź może być niepełna. Spróbuj zadać pytanie prościej lub w kilku częściach.";

const GENERATED_IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function hasSignature(message: UIMessage): boolean {
  const metadata = message.metadata as { sig?: unknown } | undefined;
  return typeof metadata?.sig === "string" && metadata.sig.length > 0;
}

// Historia wysyłana do /api/agent (mode=chat):
// 1. odpowiedzi Amber BEZ podpisu (np. przerwane błędem) są pomijane – serwer i tak by je odrzucił;
// 2. pełne zdjęcie klienta tylko w najnowszych wiadomościach (po ostatniej odpowiedzi Amber);
// 3. wygenerowane obrazy NIE wracają na serwer (z wyniku narzędzia zostaje tylko { ok });
// 4. (lekcja 4) części innych narzędzi NIE wracają na serwer – serwer ich nie potrzebuje (nie są podpisane
//    i nie trafiają do modelu). Zostaje tylko część obrazu. Rozmowa w przeglądarce wygląda tak samo.
// 5. (lekcja 4, Warsztat 2 Standard) liczniki pod odpowiedzią (metadata.stats) NIE wracają na serwer –
//    służą tylko do wyświetlenia i nie są podpisane (serwer odrzuciłby historię z tym polem).
// 6. (lekcja 4, Warsztat 2 Fast) pytanie, którego zadanie przerwano przyciskiem Stop (metadata.przerwane),
//    dostaje na końcu notatkę STOPPED_TASK_NOTE – model wie, że zadanie przerwano i nie wykonuje go sam ponownie.
//    Zawsze ta sama notatka → podpisy kolejnych odpowiedzi (obejmujące to pytanie) pozostają zgodne.
export function prepareAgentMessages(messages: UIMessage[]): UIMessage[] {
  const signed = messages.filter((message) => message.role !== "assistant" || hasSignature(message));
  const lastAssistant = signed.map((message) => message.role).lastIndexOf("assistant");
  return signed.map((message, index) => {
    if (message.role === "user") {
      const user = withStoppedTaskNote(message);
      if (index > lastAssistant) return user;
      const parts = user.parts.filter((part) => part.type !== "file");
      return { ...user, parts: parts.length > 0 ? parts : [{ type: "text" as const, text: "" }] };
    }
    const parts = message.parts
      .filter((part) => !part.type.startsWith("tool-") || part.type === "tool-generujObraz")
      .map((part) => {
        if (part.type === "tool-generujObraz" && "output" in part && part.output !== undefined) {
          const ok = (part.output as { ok?: unknown } | null)?.ok === true;
          return { ...part, output: { ok } };
        }
        return part;
      });
    // Odpowiedź bez tekstu i bez obrazu (np. same narzędzia) – pusty tekst, żeby historia pozostała poprawna.
    const hasContent = parts.some((part) => part.type === "text" || part.type === "tool-generujObraz");
    const metadata = withoutStats(message.metadata);
    return {
      ...message,
      ...(metadata !== undefined ? { metadata } : {}),
      parts: hasContent ? parts : [...parts, { type: "text" as const, text: "" }],
    } as UIMessage;
  });
}

// Liczniki (stats) i numer rozmowy w bazie (conversationId, lekcja 5) służą tylko przeglądarce – nie wracają na serwer.
function withoutStats(metadata: unknown): unknown {
  if (typeof metadata !== "object" || metadata === null || !("stats" in metadata || "conversationId" in metadata)) {
    return metadata;
  }
  const { stats: _stats, conversationId: _conversationId, ...rest } = metadata as Record<string, unknown>;
  return rest;
}

// ---------------------------------------------------------------------------
// Lekcja 5, Warsztat 2: trwałe rozmowy (Supabase)
// ---------------------------------------------------------------------------

export const LATEST_CONVERSATION_API = "/api/conversations/latest";

// Warsztat 2 (Standard): adres strony pokazuje bieżącą rozmowę – F5 zostaje w tej samej rozmowie.
//   /?c=12   – rozmowa 12 (kliknięcie na /history),
//   /?new=1  – nowa, pusta rozmowa (przycisk „Nowa rozmowa”),
//   /        – ostatnia rozmowa z bazy.
export const HISTORY_PAGE = "/history";
export const NEW_CONVERSATION_URL = "/?new=1";
export const conversationPageUrl = (id: number) => `/?c=${id}`;
export const conversationApiUrl = (id: number) => `/api/conversations/${id}`;
// Lekcja 5, Warsztat 3 (Standard): profil klienta (/api/profile) – powitanie w czacie i strona /profile.
export const PROFILE_API = "/api/profile";
export const PROFILE_PAGE = "/profile";
export type ProfileView = { name: string | null; preferences: Record<string, string> };

// Odpowiedź /api/profile → profil + powitanie (null = nieprawidłowa odpowiedź).
export function readProfileResponse(data: unknown): { profile: ProfileView; greeting: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { profile, greeting } = data as { profile?: unknown; greeting?: unknown };
  if (typeof greeting !== "string" || typeof profile !== "object" || profile === null) return null;
  const { name, preferences } = profile as { name?: unknown; preferences?: unknown };
  if (name !== null && typeof name !== "string") return null;
  if (typeof preferences !== "object" || preferences === null || Array.isArray(preferences)) return null;
  const prefs: Record<string, string> = {};
  for (const [key, value] of Object.entries(preferences as Record<string, unknown>)) {
    if (typeof value === "string") prefs[key] = value;
  }
  return { profile: { name, preferences: prefs }, greeting };
}

// Lekcja 5, Warsztat 3 (Dla szybkich): najważniejsze pozycje profilu dla Amber Security (strona /profile).
// Te same nazwy i opcje są w lib/amber-profile.ts (KEY_PREFERENCE_NAMES, CONTACT_OPTIONS – sprawdza to test).
export const KEY_PREFERENCES = [
  { key: "rodzaj_obiektu", label: "Rodzaj obiektu", hint: "np. dom, mieszkanie, biuro, sklep" },
  { key: "system_alarmowy", label: "System alarmowy", hint: "np. Ajax, Texecom, Pyronix, brak" },
  { key: "preferowany_kontakt", label: "Preferowany kontakt", options: ["telefon", "e-mail", "WhatsApp"] },
] as const;
export const KEY_PREFERENCE_EMPTY = "brak – Amber zapyta, gdy będzie potrzebne";

// Nazwa pozycji do wyświetlenia: „styl_odpowiedzi” → „Styl odpowiedzi”.
export function preferenceLabel(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Dla szybkich: komunikat, gdy usunięcie rozmowy się nie uda (przycisk „Usuń” na /history).
export const DELETE_ERROR_MESSAGE = "Nie udało się usunąć rozmowy. Spróbuj ponownie.";

export type ConversationTarget = { kind: "new" } | { kind: "id"; id: number } | { kind: "latest" };

// Ta sama reguła numeru co parseConversationParam w lib/amber-conversations.ts (sprawdza to test).
export function conversationFromSearch(search: string): ConversationTarget {
  const params = new URLSearchParams(search);
  if (params.get("new") === "1") return { kind: "new" };
  const raw = params.get("c");
  if (raw !== null && /^[1-9][0-9]{0,15}$/.test(raw) && Number.isSafeInteger(Number(raw))) {
    return { kind: "id", id: Number(raw) };
  }
  return { kind: "latest" };
}
export const HISTORY_LOADING_MESSAGE = "Wczytuję rozmowę…";
export const HISTORY_LOAD_ERROR = "Nie udało się wczytać poprzedniej rozmowy. Możesz pisać dalej – zacznie się nowa rozmowa.";

// Numer rozmowy z metadanych odpowiedzi Amber (serwer dodaje go po zapisie w bazie).
export function readConversationId(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { conversationId?: unknown }).conversationId;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Odpowiedź GET /api/conversations/latest → numer rozmowy + wiadomości do useChat (null = nieprawidłowa odpowiedź).
export function readLatestConversation(data: unknown): { conversationId: number | null; messages: UIMessage[] } | null {
  if (typeof data !== "object" || data === null) return null;
  const { conversationId, messages } = data as { conversationId?: unknown; messages?: unknown };
  if (!Array.isArray(messages)) return null;
  const valid = messages.every(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      typeof (message as UIMessage).id === "string" &&
      ((message as UIMessage).role === "user" || (message as UIMessage).role === "assistant") &&
      Array.isArray((message as UIMessage).parts),
  );
  if (!valid) return null;
  const id = conversationId === null ? null : readConversationId({ conversationId });
  if (conversationId !== null && id === null) return null;
  return { conversationId: id, messages: messages as UIMessage[] };
}

// Warsztat 2 (Standard): liczniki pod odpowiedzią, np. „Kroki modelu: 3 · Wywołania narzędzi: 2 · Czas: 8,4 s”.
// null = brak liczników (starsza odpowiedź albo nieprawidłowe dane).
export function formatAgentStats(metadata: unknown): string | null {
  const stats = (metadata as { stats?: unknown } | null | undefined)?.stats as
    | { kroki?: unknown; narzedzia?: unknown; czasMs?: unknown }
    | undefined;
  if (typeof stats !== "object" || stats === null) return null;
  const { kroki, narzedzia, czasMs } = stats;
  const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!isCount(kroki) || !isCount(narzedzia) || !isCount(czasMs)) return null;
  const seconds = (czasMs / 1000).toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `Kroki modelu: ${kroki} · Wywołania narzędzi: ${narzedzia} · Czas: ${seconds} s`;
}

// Lekcja 4, Warsztat 2 (Fast): notatka dopisywana w historii do pytania, którego zadanie przerwano przyciskiem Stop.
export const STOPPED_TASK_NOTE = "[Klient przerwał to zadanie przyciskiem Stop.]";
// Taki sam limit jak MAX_USER_MESSAGE_CHARS w lib/amber-history.ts (sprawdza to test).
export const MAX_HISTORY_USER_TEXT_CHARS = 4000;
const STOPPED_TASK_SUFFIX = `\n\n${STOPPED_TASK_NOTE}`;

// Oznaczenie pytania (wiadomości klienta), którego zadanie przerwano – zapisane w samej wiadomości,
// żeby każda kolejna historia dostała notatkę w tej samej postaci.
export function markStoppedQuestion(messages: UIMessage[], questionId: string): UIMessage[] {
  return messages.map((message) =>
    message.id === questionId && message.role === "user"
      ? { ...message, metadata: { ...(isRecord(message.metadata) ? message.metadata : {}), przerwane: true } }
      : message,
  );
}

// Pytanie, którego dotyczyło przerwane zadanie: ostatnia wiadomość klienta.
export function stoppedQuestionId(messages: UIMessage[]): string | null {
  return [...messages].reverse().find((m) => m.role === "user")?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Kopia oznaczonego pytania do historii: bez pola „przerwane”, z notatką na końcu (w limicie znaków).
function withStoppedTaskNote(message: UIMessage): UIMessage {
  if (!isRecord(message.metadata) || message.metadata.przerwane !== true) return message;
  const { przerwane: _przerwane, ...rest } = message.metadata;
  const base = Object.keys(rest).length > 0 ? { ...message, metadata: rest } : { ...message, metadata: undefined };
  if (base.metadata === undefined) delete (base as { metadata?: unknown }).metadata;
  const textParts = message.parts.filter((part) => part.type === "text");
  const text = textParts.map((part) => (part as { text: string }).text).join("");
  const room = MAX_HISTORY_USER_TEXT_CHARS - STOPPED_TASK_SUFFIX.length;
  if (text.length <= room) {
    return { ...base, parts: [...message.parts, { type: "text" as const, text: STOPPED_TASK_SUFFIX }] } as UIMessage;
  }
  // Bardzo długie pytanie: skrócone tak, żeby razem z notatką zmieściło się w limicie (zawsze tak samo).
  const others = message.parts.filter((part) => part.type !== "text");
  return {
    ...base,
    parts: [...others, { type: "text" as const, text: `${text.slice(0, room - 1)}…` }, { type: "text" as const, text: STOPPED_TASK_SUFFIX }],
  } as UIMessage;
}

// Lekcja 4, Warsztat 2 (Fast): przycisk „Stop” – widoczny tylko wtedy, gdy agent wykonuje zadanie.
// Po kliknięciu useChat przerywa zapytanie (fetch), a serwer przez req.signal przerywa model i narzędzia.
// Częściowa odpowiedź zostaje w rozmowie z komunikatem poniżej. Nie ma podpisu, więc – jak każda
// niepodpisana odpowiedź – nie wraca do serwera w historii (patrz punkt 1 wyżej).
export const STOPPED_MESSAGE = "Przerwane przez użytkownika";

export function canStop(status: string): boolean {
  return status === "submitted" || status === "streaming";
}

// Gdzie pokazać komunikat po przerwaniu: pod częściową odpowiedzią Amber, a gdy odpowiedź jeszcze się
// nie pojawiła (Stop zaraz po wysłaniu) – pod ostatnią wiadomością klienta.
export function stopNoteTarget(
  message: UIMessage | undefined,
  messages: UIMessage[],
): { kind: "assistant" | "user"; id: string } | null {
  if (message?.role === "assistant" && messages.some((m) => m.id === message.id)) return { kind: "assistant", id: message.id };
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? { kind: "user", id: lastUser.id } : null;
}

// Limit kroków: model zakończył na wywołaniu narzędzia (stopWhen: isStepCount(6)).
export function isStepLimit(finishReason: string | undefined): boolean {
  return finishReason === "tool-calls";
}

export type GeneratedImageView =
  | { status: "loading" }
  | { status: "done"; url: string; model?: string }
  | { status: "error"; error: string };

// Część „tool-generujObraz” → co pokazać w rozmowie.
export function readGeneratedImagePart(part: unknown): GeneratedImageView | null {
  if (typeof part !== "object" || part === null) return null;
  const p = part as { type?: unknown; state?: unknown; output?: unknown; errorText?: unknown };
  if (p.type !== "tool-generujObraz") return null;
  if (p.state === "input-streaming" || p.state === "input-available") return { status: "loading" };
  if (p.state === "output-error") return { status: "error", error: "Nie udało się wygenerować obrazu. Spróbuj ponownie." };
  if (p.state === "output-available") {
    const out = p.output as { ok?: unknown; image?: unknown; model?: unknown; error?: unknown } | null;
    if (out?.ok === true && typeof out.image === "string" && GENERATED_IMAGE_URL.test(out.image)) {
      return { status: "done", url: out.image, model: typeof out.model === "string" ? out.model : undefined };
    }
    return {
      status: "error",
      error: typeof out?.error === "string" ? out.error : "Nie udało się wygenerować obrazu. Spróbuj ponownie.",
    };
  }
  return null;
}

// Nazwa pobieranego pliku, np. amber-obraz-2026-11-11-1530.png
export function imageDownloadName(url: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ext = url.startsWith("data:image/jpeg") ? "jpg" : url.startsWith("data:image/webp") ? "webp" : "png";
  return `amber-obraz-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${ext}`;
}

// Wynik mode=analyze – sprawdzany także w przeglądarce przed pokazaniem.
export type AnalysisResult = { category: string; priority: string; draft: string; needs_review: boolean };
export function readAnalysisResponse(data: unknown): { analysis: AnalysisResult; model?: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { analysis, model } = data as { analysis?: unknown; model?: unknown };
  if (typeof analysis !== "object" || analysis === null) return null;
  const a = analysis as Record<string, unknown>;
  if (typeof a.category !== "string" || typeof a.priority !== "string" || typeof a.draft !== "string" || typeof a.needs_review !== "boolean") {
    return null;
  }
  return {
    analysis: { category: a.category, priority: a.priority, draft: a.draft, needs_review: a.needs_review },
    ...(typeof model === "string" ? { model } : {}),
  };
}

// Etap 4: przycisk „Wygeneruj obraz” wysyła do /api/agent (mode=chat) wyraźną prośbę klienta.
// Narzędzie generujObraz wybiera i wywołuje model – przycisk niczego nie generuje sam.
export const MAX_IMAGE_DESCRIPTION_CHARS = 500; // taki sam limit jak w narzędziu (lib/amber-image.ts)
export const IMAGE_REQUEST_PREFIX = "Proszę wygenerować obraz: ";
export const NO_IMAGE_MESSAGE = "Model nie wygenerował obrazu dla tego opisu. Spróbuj opisać go inaczej.";

// Opis 1–500 znaków (po obcięciu spacji) → treść wiadomości; inaczej null (nic nie jest wysyłane).
export function buildImageRequest(description: string): string | null {
  const text = description.trim();
  if (text.length === 0 || text.length > MAX_IMAGE_DESCRIPTION_CHARS) return null;
  return `${IMAGE_REQUEST_PREFIX}${text}`;
}

// Czy odpowiedź Amber zawiera część narzędzia generujObraz (udaną lub nie).
export function hasImageToolPart(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === "tool-generujObraz");
}

// Czy wiadomość Amber ma już coś do pokazania (tekst, obraz z narzędzia, źródła).
// Bez treści – zamiast pustego dymka czat pokazuje „Model pisze…” (w trakcie) albo nic (po zakończeniu).
export function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      (part.type === "text" && part.text.trim().length > 0) ||
      part.type === "tool-generujObraz" ||
      part.type === "source-url",
  );
}


// Lekcja 4, Warsztat 2 (ReAct): lista rzeczywiście wykonanych kroków z narzędziami, np. „1. czas → 2. pogoda, waluty”.
// Numer = numer kroku modelu (znacznik „step-start”). Kroki bez narzędzi (samo pisanie odpowiedzi) nie są pokazywane.
// Wyszukiwanie rozpoznajemy po źródłach z wyszukiwarki; źródło z Wikipedii (sourceId „wiki-…”) nie jest wyszukiwaniem.
// Tylko do wyświetlania – nie wpływa na podpis ani historię.
export type AgentStep = { nr: number; tools: string[] };

export function buildStepList(message: UIMessage): AgentStep[] {
  const steps: AgentStep[] = [];
  let nr = 0;
  let current: AgentStep | null = null;
  const add = (name: string) => {
    if (nr === 0) nr = 1; // starsza odpowiedź bez znaczników kroków
    if (!current || current.nr !== nr) {
      current = { nr, tools: [] };
      steps.push(current);
    }
    if (!current.tools.includes(name)) current.tools.push(name);
  };
  for (const part of message.parts) {
    if (part.type === "step-start") {
      nr++;
      continue;
    }
    if (part.type === "source-url") {
      const id = (part as { sourceId?: unknown }).sourceId;
      if (!(typeof id === "string" && id.startsWith("wiki-"))) add("wyszukiwanie");
      continue;
    }
    if (part.type.startsWith("tool-")) {
      const raw = part.type.slice(5);
      const name = raw === "web_search" ? "wyszukiwanie" : raw;
      const state = (part as { state?: unknown }).state;
      add(state === "output-error" ? `${name} (błąd)` : name);
    }
  }
  return steps;
}

export function formatStepList(steps: AgentStep[]): string {
  return steps.map((s) => `${s.nr}. ${s.tools.join(", ")}`).join(" → ");
}
