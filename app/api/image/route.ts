import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { SESSION_COOKIE, getAuthConfig, isSessionValid, readCookie } from "../../../lib/auth";
import {
  IMAGE_MESSAGES,
  IMAGE_MODEL_ID,
  checkImagePrompt,
  generateAmberImage,
} from "../../../lib/amber-image";

// Lekcja 3 (B): generowanie obrazu. Ten plik działa tylko na serwerze – klucz API nie trafia do przeglądarki.
export async function POST(req: Request) {
  // 1. Najpierw sesja. Bez ważnej sesji: 401 i żadnego wywołania modelu.
  const authConfig = getAuthConfig();
  const sessionToken = readCookie(req, SESSION_COOKIE);
  if (!authConfig || !sessionToken || !isSessionValid(sessionToken, authConfig)) {
    return Response.json({ error: "Brak dostępu: zaloguj się hasłem warsztatowym." }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[Amber] Brak OPENROUTER_API_KEY w konfiguracji serwera.");
    return Response.json({ error: IMAGE_MESSAGES.config }, { status: 500 });
  }

  // 2. Opis obrazu: 1–500 znaków.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: IMAGE_MESSAGES.badRequest }, { status: 400 });
  }
  const checked = checkImagePrompt(body);
  if (!checked.ok) return Response.json({ error: checked.message }, { status: 400 });

  // 3. Odczyt identyfikatora modelu z surowej odpowiedzi OpenRouter (pole "model", jeśli jest).
  let apiModel: string | undefined;
  const openrouter = createOpenRouter({
    apiKey,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      try {
        const data: unknown = await response.clone().json();
        const model = (data as { model?: unknown } | null)?.model;
        if (typeof model === "string" && model.length > 0) apiModel = model;
      } catch {
        // odpowiedź bez JSON – zostaje identyfikator z metadanych AI SDK
      }
      return response;
    },
  });

  const result = await generateAmberImage({
    model: openrouter.imageModel(IMAGE_MODEL_ID),
    prompt: checked.prompt,
    abortSignal: req.signal,
    apiModelId: () => apiModel,
  });

  if (!result.ok) {
    console.error(`[Amber] Generowanie obrazu nie powiodło się: ${result.details}`);
    return Response.json({ error: result.message }, { status: result.status });
  }

  console.log(
    `[Amber] Obraz wygenerował model: ${result.modelId} (${apiModel ? "z odpowiedzi API" : "z metadanych AI SDK"})`,
  );
  return Response.json({ image: result.dataUrl, model: result.modelId });
}
