// Testy lekcji 3 (B): generowanie obrazu – BEZ wywoływania prawdziwego modelu (nic nie trafia do OpenRouter).
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-image.mjs

import { APICallError, NoContentGeneratedError } from "ai";
import { MockImageModelV4 } from "ai/test";
import {
  IMAGE_MESSAGES,
  IMAGE_MODEL_ID,
  MAX_IMAGE_PROMPT_CHARS,
  checkImagePrompt,
  generateAmberImage,
} from "../lib/amber-image.ts";

let passed = 0;
let failed = 0;
function check(name, condition, info = "") {
  condition ? passed++ : failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${info ? `  → ${info}` : ""}`);
}

// Najmniejszy prawdziwy obraz PNG (1×1 piksel).
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mockImageModel({ images = [PNG_1PX], modelId = IMAGE_MODEL_ID, error } = {}) {
  return new MockImageModelV4({
    modelId: IMAGE_MODEL_ID,
    doGenerate: async () => {
      if (error) throw error;
      return { images, warnings: [], response: { timestamp: new Date(0), modelId, headers: {} } };
    },
  });
}

console.log("\n=== Opis obrazu (1–500 znaków) ===");
{
  const ok = checkImagePrompt({ prompt: "  Logo firmy ochrony – tarcza w kolorze bursztynu  " });
  check("Poprawny opis → przyjęty (bez spacji na brzegach)", ok.ok && ok.prompt === "Logo firmy ochrony – tarcza w kolorze bursztynu");
  const exact = checkImagePrompt({ prompt: "a".repeat(MAX_IMAGE_PROMPT_CHARS) });
  check(`Opis o długości dokładnie ${MAX_IMAGE_PROMPT_CHARS} znaków → przyjęty`, exact.ok);
  const long = checkImagePrompt({ prompt: "a".repeat(MAX_IMAGE_PROMPT_CHARS + 1) });
  check(`Opis ${MAX_IMAGE_PROMPT_CHARS + 1} znaków → odrzucony`, !long.ok && long.message === IMAGE_MESSAGES.tooLong);
  const empty = checkImagePrompt({ prompt: "   " });
  check("Pusty opis → odrzucony", !empty.ok && empty.message === IMAGE_MESSAGES.empty);
  for (const [name, body] of [["Brak pola prompt", {}], ["prompt jako liczba", { prompt: 5 }], ["Body jako tablica", ["x"]], ["Body null", null]]) {
    const r = checkImagePrompt(body);
    check(`${name} → odrzucone`, !r.ok && r.message === IMAGE_MESSAGES.badRequest);
  }
}

console.log("\n=== Generowanie (sztuczny model) ===");
{
  const r = await generateAmberImage({ model: mockImageModel(), prompt: "test", maxRetries: 0 });
  check("Obraz zwrócony jako data:image/png;base64", r.ok && r.dataUrl === `data:image/png;base64,${PNG_1PX}`, r.ok ? r.mediaType : r.details);
  check("Model z metadanych odpowiedzi", r.ok && r.modelId === IMAGE_MODEL_ID, r.ok ? r.modelId : "");

  const fromApi = await generateAmberImage({
    model: mockImageModel(), prompt: "test", maxRetries: 0, apiModelId: () => "google/gemini-3.1-flash-image-preview-20261101",
  });
  check("Model z surowej odpowiedzi API ma pierwszeństwo", fromApi.ok && fromApi.modelId === "google/gemini-3.1-flash-image-preview-20261101");

  const other = await generateAmberImage({ model: mockImageModel({ modelId: "google/inny-model" }), prompt: "test", maxRetries: 0 });
  check("Pokazany model = ten z odpowiedzi (nie wpisany na sztywno)", other.ok && other.modelId === "google/inny-model");

  const none = await generateAmberImage({ model: mockImageModel({ images: [] }), prompt: "test", maxRetries: 0 });
  check("Brak obrazu w odpowiedzi → komunikat po polsku", !none.ok && none.message === IMAGE_MESSAGES.noImage, none.ok ? "" : none.details);

  const noContent = await generateAmberImage({
    model: mockImageModel({ error: new NoContentGeneratedError({ message: "No images in response" }) }), prompt: "test", maxRetries: 0,
  });
  check("OpenRouter: odpowiedź bez obrazów → „nie wygenerował obrazu” (nie „niedostępny”)",
    !noContent.ok && noContent.message === IMAGE_MESSAGES.noImage, noContent.ok ? "" : noContent.details);

  const refused = await generateAmberImage({
    model: mockImageModel({ error: new APICallError({
      message: "[Google AI Studio] Gemini could not generate an image (STOP)",
      url: "https://openrouter.ai/api/v1/images", requestBodyValues: {}, statusCode: 400, isRetryable: false,
    }) }), prompt: "logo amber", maxRetries: 0,
  });
  check("Gemini „could not generate an image” (400) → „nie wygenerował obrazu”",
    !refused.ok && refused.message === IMAGE_MESSAGES.noImage, refused.ok ? "" : refused.details);

  const big = await generateAmberImage({ model: mockImageModel({ images: ["A".repeat(4_000_004)] }), prompt: "test", maxRetries: 0 });
  check("Za duży obraz → odrzucony", !big.ok && big.message === IMAGE_MESSAGES.tooLarge);

  const apiError = new APICallError({
    message: "No endpoints found for google/gemini-3.1-flash-image-preview",
    url: "https://openrouter.ai/api/v1/images", requestBodyValues: {}, statusCode: 404, isRetryable: false,
  });
  const down = await generateAmberImage({ model: mockImageModel({ error: apiError }), prompt: "test", maxRetries: 0 });
  check("Model niedostępny (404) → komunikat po polsku", !down.ok && down.status === 502 && down.message === IMAGE_MESSAGES.unavailable, down.ok ? "" : down.details);

  const crash = await generateAmberImage({ model: mockImageModel({ error: new Error("boom") }), prompt: "test", maxRetries: 0 });
  check("Nieoczekiwany błąd → komunikat po polsku", !crash.ok && crash.message === IMAGE_MESSAGES.unavailable);
  check("Komunikaty dla klienta nie zawierają szczegółów technicznych", !down.ok && !down.message.includes("APICallError") && !down.message.includes("404"));
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
