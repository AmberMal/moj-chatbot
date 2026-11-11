// W2: uporządkowany wynik Amber (structured output) + walidacja po stronie serwera.
// Ten plik działa tylko na serwerze. JSON jest WEWNĘTRZNYM formatem danych aplikacji –
// klient końcowy ma widzieć tylko treść pola `draft`.

import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  isStepCount,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";

// ---------------------------------------------------------------------------
// 1. Dozwolone wartości i typ wyniku
// ---------------------------------------------------------------------------

export const AMBER_CATEGORIES = ["sales", "support", "billing", "unknown"] as const;
export const AMBER_PRIORITIES = ["normal", "high"] as const;

export type AmberCategory = (typeof AMBER_CATEGORIES)[number];
export type AmberPriority = (typeof AMBER_PRIORITIES)[number];

export type AmberOutput = {
  category: AmberCategory; // sales | support | billing | unknown
  priority: AmberPriority; // normal | high (high ≠ gwarancja czasu reakcji)
  draft: string; // szkic odpowiedzi dla klienta – NIE jest wysyłany automatycznie
  needs_review: boolean; // true = potrzebna decyzja / brak informacji
};

// ---------------------------------------------------------------------------
// 2. Schemat JSON (dokładnie jak w ćwiczeniu W2) – wysyłany do modelu
// ---------------------------------------------------------------------------

export const AMBER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["sales", "support", "billing", "unknown"] },
    priority: { type: "string", enum: ["normal", "high"] },
    draft: { type: "string" },
    needs_review: { type: "boolean" },
  },
  required: ["category", "priority", "draft", "needs_review"],
  additionalProperties: false,
} as const;

const REQUIRED_FIELDS = ["category", "priority", "draft", "needs_review"] as const;

// ---------------------------------------------------------------------------
// 3. Walidator – własna, ścisła kontrola (bez dodatkowych bibliotek)
// Niczego nie poprawia i nie uzupełnia: błędny wynik jest odrzucany.
// ---------------------------------------------------------------------------

export type AmberValidation =
  | { success: true; value: AmberOutput }
  | { success: false; errors: string[] };

export function validateAmberOutput(value: unknown): AmberValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, errors: ["Wynik nie jest obiektem JSON."] };
  }

  const data = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      errors.push(`Brak wymaganego pola: ${field}.`);
    }
  }

  for (const key of Object.keys(data)) {
    if (!(REQUIRED_FIELDS as readonly string[]).includes(key)) {
      errors.push(`Niedozwolone dodatkowe pole: ${key}.`);
    }
  }

  if ("category" in data) {
    if (typeof data.category !== "string") {
      errors.push("Pole category musi być tekstem.");
    } else if (!(AMBER_CATEGORIES as readonly string[]).includes(data.category)) {
      errors.push(`Niedozwolona wartość category: ${data.category}.`);
    }
  }

  if ("priority" in data) {
    if (typeof data.priority !== "string") {
      errors.push("Pole priority musi być tekstem.");
    } else if (!(AMBER_PRIORITIES as readonly string[]).includes(data.priority)) {
      errors.push(`Niedozwolona wartość priority: ${data.priority}.`);
    }
  }

  if ("draft" in data) {
    if (typeof data.draft !== "string") {
      errors.push("Pole draft musi być tekstem.");
    } else if (data.draft.trim().length === 0) {
      // Dodatkowa reguła: pusty szkic nie jest użyteczną odpowiedzią dla klienta.
      errors.push("Pole draft nie może być puste.");
    }
  }

  if ("needs_review" in data && typeof data.needs_review !== "boolean") {
    errors.push("Pole needs_review musi być wartością logiczną (true/false), a nie tekstem.");
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, value: data as AmberOutput };
}

// Schemat dla AI SDK: model dostaje schemat JSON, a wynik sprawdza nasz walidator.
export const amberOutputSchema = jsonSchema<AmberOutput>(AMBER_OUTPUT_JSON_SCHEMA, {
  validate: (value) => {
    const check = validateAmberOutput(value);
    return check.success
      ? { success: true, value: check.value }
      : { success: false, error: new Error(check.errors.join(" ")) };
  },
});

// ---------------------------------------------------------------------------
// 4. Wywołanie modelu i rozpoznanie wszystkich przypadków błędów
// ---------------------------------------------------------------------------

export type AmberFailureKind = "invalid_output" | "refusal" | "interrupted" | "provider_error";

// Źródło z wyszukiwania w internecie (lekcja 3). Tylko adresy http(s).
export type AmberSource = { url: string; title: string };

export const MAX_SOURCES = 6;

// Bezpieczne źródła: tylko http/https (bez javascript: itp.), bez duplikatów, z limitem.
export function cleanSources(raw: Array<{ url?: unknown; title?: unknown }>): AmberSource[] {
  const seen = new Set<string>();
  const out: AmberSource[] = [];
  for (const item of raw) {
    if (typeof item.url !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const title =
      typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 200) : parsed.hostname;
    out.push({ url, title });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

// Lekcja 3: nazwy użytych narzędzi (do etykiet w czacie), w stałej kolejności.
export type AmberToolName = "wyszukiwanie" | "aktualnyCzas" | "sprawdzObszar" | "informacjeOUrzadzeniu";
const FUNCTION_TOOL_NAMES = ["aktualnyCzas", "sprawdzObszar", "informacjeOUrzadzeniu"] as const;

export type AmberResult =
  | { ok: true; output: AmberOutput; sources: AmberSource[]; tools: AmberToolName[]; modelId: string }
  | { ok: false; kind: AmberFailureKind; message: string; details: string };

// Komunikaty dla użytkownika (po polsku). Szczegóły techniczne idą tylko do logów serwera.
export const AMBER_FAILURE_MESSAGES: Record<AmberFailureKind, string> = {
  invalid_output:
    "Model zwrócił odpowiedź w nieprawidłowym formacie. Odpowiedź została odrzucona – spróbuj ponownie.",
  refusal: "Model odmówił przygotowania odpowiedzi. Spróbuj sformułować wiadomość inaczej.",
  interrupted: "Odpowiedź modelu została przerwana i nie jest kompletna. Spróbuj ponownie.",
  provider_error: "Wystąpił błąd dostawcy AI (OpenRouter). Spróbuj ponownie za chwilę.",
};

function fail(kind: AmberFailureKind, details: string): AmberResult {
  return { ok: false, kind, message: AMBER_FAILURE_MESSAGES[kind], details };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function generateAmberOutput({
  model,
  instructions,
  messages,
  abortSignal,
  maxRetries,
  tools,
}: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  maxRetries?: number;
  tools?: ToolSet;
}): Promise<AmberResult> {
  try {
    const result = await generateText({
      model,
      instructions,
      messages,
      output: Output.object({ schema: amberOutputSchema }),
      // Lekcja 3: narzędzia (np. wyszukiwanie) + kilka kroków; wynik JSON też jest krokiem.
      tools,
      stopWhen: isStepCount(5),
      abortSignal,
      maxRetries,
    });

    // Odmowa modelu (filtr treści).
    if (result.finishReason === "content-filter") {
      return fail("refusal", "finishReason=content-filter");
    }

    // Przerwana odpowiedź: SDK potrafi przepuścić wynik ucięty np. limitem długości,
    // jeśli JSON akurat jest kompletny – dlatego sami wymagamy zakończenia "stop".
    if (result.finishReason !== "stop") {
      return fail("interrupted", `finishReason=${result.finishReason}`);
    }

    // Druga, niezależna kontrola (na wypadek zmian w bibliotece).
    const check = validateAmberOutput(result.output);
    if (!check.success) {
      return fail("invalid_output", check.errors.join(" "));
    }

    // Źródła ze wszystkich kroków (wyszukiwanie w internecie), oczyszczone.
    const sources = cleanSources(
      result.steps.flatMap((step) => step.sources).filter((source) => source.sourceType === "url"),
    );

    // Użyte narzędzia: aktualnyCzas z wywołań narzędzi; wyszukiwanie wykonuje OpenRouter
    // po swojej stronie, więc rozpoznajemy je po źródłach.
    const calledNames = new Set(result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)));
    const usedTools: AmberToolName[] = [];
    if (sources.length > 0) usedTools.push("wyszukiwanie");
    for (const name of FUNCTION_TOOL_NAMES) {
      if (calledNames.has(name)) usedTools.push(name);
    }

    // Identyfikator modelu z odpowiedzi API (nie wpisany na sztywno).
    const modelId = typeof result.response?.modelId === "string" ? result.response.modelId.slice(0, 120) : "";

    return { ok: true, output: check.value, sources, tools: usedTools, modelId };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return fail("interrupted", "Połączenie zostało przerwane (abort).");
    }

    if (NoObjectGeneratedError.isInstance(error)) {
      if (error.finishReason === "content-filter") {
        return fail("refusal", "NoObjectGeneratedError, finishReason=content-filter");
      }
      if (error.finishReason && error.finishReason !== "stop") {
        return fail("interrupted", `NoObjectGeneratedError, finishReason=${error.finishReason}`);
      }
      const cause = error.cause instanceof Error ? error.cause.message : "";
      return fail("invalid_output", `NoObjectGeneratedError: ${cause || error.message}`);
    }

    // Model nie oddał żadnej treści – typowo odmowa.
    if (NoOutputGeneratedError.isInstance(error)) {
      return fail("refusal", `NoOutputGeneratedError: ${error.message}`);
    }

    if (APICallError.isInstance(error)) {
      return fail("provider_error", `APICallError ${error.statusCode ?? ""}: ${error.message}`);
    }

    const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return fail("provider_error", details);
  }
}
