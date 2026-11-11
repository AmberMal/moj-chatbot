// Lekcja 3 (B): generowanie obrazu – sprawdzanie opisu, wywołanie modelu i komunikaty błędów.
// Plik działa tylko na serwerze (endpoint /api/image). Model obrazów: Nano Banana 2 przez OpenRouter.

import {
  APICallError,
  NoContentGeneratedError,
  NoImageGeneratedError,
  generateImage,
  type ImageModel,
} from "ai";

export const IMAGE_MODEL_ID = "google/gemini-3.1-flash-image-preview";
export const MAX_IMAGE_PROMPT_CHARS = 500;
// Odpowiedź z obrazem musi się zmieścić w limicie Vercel (~4,5 MB).
export const MAX_GENERATED_IMAGE_BASE64_CHARS = 4_000_000;
const ALLOWED_OUTPUT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const IMAGE_MESSAGES = {
  badRequest: "Nieprawidłowe zapytanie. Odśwież stronę i spróbuj ponownie.",
  empty: "Wpisz opis obrazu.",
  tooLong: `Opis obrazu może mieć maksymalnie ${MAX_IMAGE_PROMPT_CHARS} znaków.`,
  unavailable: "Model obrazów jest teraz niedostępny. Spróbuj ponownie za chwilę.",
  noImage: "Model nie wygenerował obrazu dla tego opisu. Spróbuj opisać go inaczej.",
  tooLarge: "Wygenerowany obraz jest za duży do wyświetlenia. Spróbuj ponownie.",
  config: "Generowanie obrazów nie jest skonfigurowane na serwerze.",
} as const;

export type ImagePromptCheck = { ok: true; prompt: string } | { ok: false; message: string };

// Body zapytania: { prompt: string } – 1–500 znaków po obcięciu spacji.
export function checkImagePrompt(body: unknown): ImagePromptCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: IMAGE_MESSAGES.badRequest };
  }
  const value = (body as Record<string, unknown>).prompt;
  if (typeof value !== "string") return { ok: false, message: IMAGE_MESSAGES.badRequest };
  const prompt = value.trim();
  if (prompt.length === 0) return { ok: false, message: IMAGE_MESSAGES.empty };
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) return { ok: false, message: IMAGE_MESSAGES.tooLong };
  return { ok: true, prompt };
}

export type AmberImageResult =
  | { ok: true; dataUrl: string; mediaType: string; modelId: string }
  | { ok: false; status: number; message: string; details: string };

export async function generateAmberImage({
  model,
  prompt,
  abortSignal,
  maxRetries = 1,
  apiModelId,
}: {
  model: ImageModel;
  prompt: string;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  // Identyfikator modelu odczytany z surowej odpowiedzi API (jeśli API go podało).
  apiModelId?: () => string | undefined;
}): Promise<AmberImageResult> {
  try {
    const result = await generateImage({ model, prompt, n: 1, abortSignal, maxRetries });
    const image = result.image;
    if (!image?.base64) {
      return { ok: false, status: 502, message: IMAGE_MESSAGES.noImage, details: "empty-image" };
    }
    if (image.base64.length > MAX_GENERATED_IMAGE_BASE64_CHARS) {
      return { ok: false, status: 502, message: IMAGE_MESSAGES.tooLarge, details: `size ${image.base64.length}` };
    }
    const mediaType = ALLOWED_OUTPUT_TYPES.includes(image.mediaType) ? image.mediaType : "image/png";
    // Model z odpowiedzi API; gdy API go nie poda – z metadanych odpowiedzi AI SDK.
    const modelId = (apiModelId?.() || result.responses[0]?.modelId || "").slice(0, 120);
    return { ok: true, dataUrl: `data:${mediaType};base64,${image.base64}`, mediaType, modelId };
  } catch (error) {
    // Model odpowiedział, ale bez obrazu (np. tylko tekstem) – to nie awaria, tylko opis do zmiany.
    if (NoImageGeneratedError.isInstance(error) || NoContentGeneratedError.isInstance(error)) {
      return { ok: false, status: 502, message: IMAGE_MESSAGES.noImage, details: `${error.name}: ${error.message}` };
    }
    if (APICallError.isInstance(error)) {
      // np. 400 „[Google AI Studio] Gemini could not generate an image (STOP)” – model nie stworzył obrazu.
      const noImage = error.statusCode === 400 && /could not generate|no image|safety|blocked|prohibited/i.test(error.message);
      return {
        ok: false,
        status: 502,
        message: noImage ? IMAGE_MESSAGES.noImage : IMAGE_MESSAGES.unavailable,
        details: `APICallError ${error.statusCode ?? ""}: ${error.message}`,
      };
    }
    const details = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    return { ok: false, status: 502, message: IMAGE_MESSAGES.unavailable, details };
  }
}
