import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

// Ten plik działa tylko na serwerze. Klucz API nigdy nie trafia do przeglądarki.
export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;

  if (!apiKey || !modelId) {
    return new Response(
      "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom ponownie serwer (npm run dev).",
      { status: 500 },
    );
  }

  // Cała historia bieżącej rozmowy, wysłana przez useChat.
  const { messages }: { messages: UIMessage[] } = await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Brak wiadomości do wysłania.", { status: 400 });
  }

  const openrouter = createOpenRouter({ apiKey });

  const result = streamText({
    model: openrouter(modelId),
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        console.error(error);
        const details = error instanceof Error ? error.message : String(error);
        return `Model nie odpowiedział (${details}). Sprawdź klucz, nazwę modelu i środki na koncie OpenRouter.`;
      },
    }),
  });
}
