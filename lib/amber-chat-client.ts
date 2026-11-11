// Warsztat 3: pomocnicze funkcje czatu w przeglądarce (app/chat.tsx) dla /api/agent.
// Bez sekretów i bez dostępu do serwera – tylko przygotowanie historii i odczyt części wiadomości.

import type { UIMessage } from "ai";

export const AGENT_API = "/api/agent";
export const STEP_LIMIT_MESSAGE =
  "Osiągnięto limit 5 kroków – odpowiedź może być niepełna. Spróbuj zadać pytanie prościej lub w kilku częściach.";

const GENERATED_IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function hasSignature(message: UIMessage): boolean {
  const metadata = message.metadata as { sig?: unknown } | undefined;
  return typeof metadata?.sig === "string" && metadata.sig.length > 0;
}

// Historia wysyłana do /api/agent (mode=chat):
// 1. odpowiedzi Amber BEZ podpisu (np. przerwane błędem) są pomijane – serwer i tak by je odrzucił;
// 2. pełne zdjęcie klienta tylko w najnowszych wiadomościach (po ostatniej odpowiedzi Amber);
// 3. wygenerowane obrazy NIE wracają na serwer (z wyniku narzędzia zostaje tylko { ok }).
export function prepareAgentMessages(messages: UIMessage[]): UIMessage[] {
  const signed = messages.filter((message) => message.role !== "assistant" || hasSignature(message));
  const lastAssistant = signed.map((message) => message.role).lastIndexOf("assistant");
  return signed.map((message, index) => {
    if (message.role === "user") {
      if (index > lastAssistant) return message;
      const parts = message.parts.filter((part) => part.type !== "file");
      return { ...message, parts: parts.length > 0 ? parts : [{ type: "text" as const, text: "" }] };
    }
    const parts = message.parts.map((part) => {
      if (part.type === "tool-generujObraz" && "output" in part && part.output !== undefined) {
        const ok = (part.output as { ok?: unknown } | null)?.ok === true;
        return { ...part, output: { ok } };
      }
      return part;
    });
    return { ...message, parts } as UIMessage;
  });
}

// Limit kroków: model zakończył na wywołaniu narzędzia (stopWhen: isStepCount(5)).
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

