// Testy lekcji 3 (B): generowanie obrazu – BEZ wywoływania prawdziwego modelu (nic nie trafia do OpenRouter).
// Uruchomienie (w folderze projektu):
//   node --experimental-strip-types scripts/test-amber-image.mjs

import { APICallError, NoContentGeneratedError, generateText, isStepCount } from "ai";
import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import {
  IMAGE_MESSAGES,
  IMAGE_MODEL_ID,
  MAX_IMAGE_PROMPT_CHARS,
  IMAGE_TOOL_MODEL_TEXT,
  checkImagePrompt,
  createImageTool,
  generateAmberImage,
  imageToolModelText,
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

console.log("\n=== Warsztat 3: narzędzie generujObraz (wybierane przez model) ===");
{
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const countingModel = (opts) => {
    const m = mockImageModel(opts);
    const original = m.doGenerate;
    m.calls = 0;
    m.doGenerate = async (...args) => { m.calls++; return original(...args); };
    return m;
  };
  const opts = { toolCallId: "c1", messages: [] };

  // 1. execute: obraz i model trafiają do przeglądarki
  {
    const imageModel = countingModel();
    const t = createImageTool({ model: imageModel, maxRetries: 0 });
    const out = await t.execute({ opis: "Plakat z alarmem" }, opts);
    check("execute → obraz (data:image/png;base64) i model dla przeglądarki",
      out.ok === true && out.image === `data:image/png;base64,${PNG_1PX}` && out.model === IMAGE_MODEL_ID, JSON.stringify({ ok: out.ok, model: out.model }));
    const modelView = await t.toModelOutput({ toolCallId: "c1", input: { opis: "x" }, output: out });
    check("toModelOutput → tylko krótki tekst „Obraz wygenerowany…”",
      modelView.type === "text" && modelView.value === IMAGE_TOOL_MODEL_TEXT.done, JSON.stringify(modelView));
    check("toModelOutput nie zawiera danych obrazu ani adresu data:",
      !JSON.stringify(modelView).includes(PNG_1PX) && !JSON.stringify(modelView).includes("data:image"));
  }
  // 2. Model z surowej odpowiedzi API (jak w /api/image)
  {
    const t = createImageTool({ model: countingModel(), maxRetries: 0, apiModelId: () => "google/z-api" });
    const out = await t.execute({ opis: "Plakat" }, opts);
    check("execute → model z odpowiedzi API ma pierwszeństwo", out.ok && out.model === "google/z-api");
  }
  // 3. Błędy modelu obrazów → komunikat po polsku, do modelu tylko krótki tekst
  {
    const refused = createImageTool({ model: countingModel({ error: new APICallError({
      message: "[Google AI Studio] Gemini could not generate an image (STOP)", url: "https://openrouter.ai/api/v1/images",
      requestBodyValues: {}, statusCode: 400, isRetryable: false }) }), maxRetries: 0 });
    const out = await refused.execute({ opis: "logo" }, opts);
    check("Odmowa Gemini → { ok: false, „nie wygenerował obrazu” }", out.ok === false && out.error === IMAGE_MESSAGES.noImage, JSON.stringify(out));
    const view = await refused.toModelOutput({ toolCallId: "c1", input: { opis: "logo" }, output: out });
    check("toModelOutput przy błędzie → krótki tekst bez szczegółów technicznych",
      view.type === "text" && view.value.startsWith(IMAGE_TOOL_MODEL_TEXT.failed) && !view.value.includes("APICallError") && !view.value.includes("400"), view.value);

    const down = createImageTool({ model: countingModel({ error: new APICallError({
      message: "No endpoints found", url: "https://openrouter.ai/api/v1/images", requestBodyValues: {}, statusCode: 404, isRetryable: false }) }), maxRetries: 0 });
    const out2 = await down.execute({ opis: "logo" }, opts);
    check("Model obrazów niedostępny → „Model obrazów jest teraz niedostępny…”", out2.ok === false && out2.error === IMAGE_MESSAGES.unavailable);
    const crash = createImageTool({ model: countingModel({ error: new Error("boom") }), maxRetries: 0 });
    const out3 = await crash.execute({ opis: "logo" }, opts);
    check("Nieoczekiwany błąd → komunikat po polsku", out3.ok === false && out3.error === IMAGE_MESSAGES.unavailable);
    check("imageToolModelText dla nieznanego wyniku → ogólny tekst", imageToolModelText(null) === IMAGE_TOOL_MODEL_TEXT.failed);
  }
  // 4. Walidacja opisu w schemacie narzędzia (zanim zostanie wywołany model obrazów)
  {
    const t = createImageTool({ model: countingModel(), maxRetries: 0 });
    const v = (value) => t.inputSchema.validate(value);
    const okV = await v({ opis: "  Plakat  " });
    check("Schemat: poprawny opis → przyjęty i bez spacji na brzegach", okV.success && okV.value.opis === "Plakat");
    for (const [name, value] of [
      ["opis 501 znaków", { opis: "a".repeat(501) }],
      ["pusty opis", { opis: "   " }],
      ["opis jako liczba", { opis: 5 }],
      ["dodatkowe pole", { opis: "x", rozmiar: "4K" }],
      ["brak opisu", {}],
    ]) {
      const r = await v(value);
      check(`Schemat: ${name} → odrzucony`, r.success === false);
    }
    check("Schemat JSON dla modelu: maxLength 500, bez dodatkowych pól",
      t.inputSchema.jsonSchema.properties.opis.maxLength === 500 && t.inputSchema.jsonSchema.additionalProperties === false);
  }
  // 5. Pełny przepływ z modelem językowym: model wybiera narzędzie, a w kolejnym kroku widzi tylko tekst
  {
    const imageModel = countingModel();
    const lm = new MockLanguageModelV4({
      doGenerate: [
        { content: [{ type: "tool-call", toolCallId: "t1", toolName: "generujObraz", input: JSON.stringify({ opis: "Plakat z alarmem" }) }],
          finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] },
        { content: [{ type: "text", text: "Obraz jest gotowy." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
      ],
    });
    const r = await generateText({
      model: lm, prompt: "Proszę wygenerować plakat z alarmem.", maxRetries: 0,
      tools: { generujObraz: createImageTool({ model: imageModel, maxRetries: 0 }) }, stopWhen: isStepCount(5),
    });
    const toolResult = r.steps[0].toolResults[0];
    check("Model wywołał generujObraz, model obrazów wywołany 1 raz", toolResult?.toolName === "generujObraz" && imageModel.calls === 1);
    check("Wynik narzędzia (dla przeglądarki) zawiera obraz", toolResult?.output?.ok === true && toolResult.output.image.startsWith("data:image/png;base64,"));
    const secondPrompt = JSON.stringify(lm.doGenerateCalls[1]?.prompt ?? []);
    check("2. krok modelu: dostaje „Obraz wygenerowany…”", secondPrompt.includes(IMAGE_TOOL_MODEL_TEXT.done));
    check("2. krok modelu: NIE dostaje pliku obrazu (base64 / data:)", !secondPrompt.includes(PNG_1PX) && !secondPrompt.includes("data:image"));
    check("Odpowiedź końcowa modelu", r.text === "Obraz jest gotowy.");
  }
  // 6. Model poda za długi opis → narzędzie odrzuca, model obrazów NIE jest wywoływany
  {
    const imageModel = countingModel();
    const lm = new MockLanguageModelV4({
      doGenerate: [
        { content: [{ type: "tool-call", toolCallId: "t1", toolName: "generujObraz", input: JSON.stringify({ opis: "a".repeat(501) }) }],
          finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] },
        { content: [{ type: "text", text: "Proszę o krótszy opis." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
      ],
    });
    await generateText({ model: lm, prompt: "x", maxRetries: 0, tools: { generujObraz: createImageTool({ model: imageModel, maxRetries: 0 }) }, stopWhen: isStepCount(5) });
    check("Za długi opis od modelu → model obrazów nie został wywołany (brak kosztu)", imageModel.calls === 0);
  }
}

console.log(`\nWynik: ${passed} zaliczonych, ${failed} niezaliczonych.`);
process.exit(failed === 0 ? 0 : 1);
