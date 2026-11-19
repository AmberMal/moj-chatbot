// Lekcja 6: modele AI w jednym miejscu (tylko serwer – klucz OpenRouter nie trafia do przeglądarki).
// – model rozmowy: zmienna OPENROUTER_MODEL (czat i dashboard na razie tworzą go jak dotąd, w swoich endpointach);
// – model embeddingów: zmienna OPENROUTER_EMBEDDING_MODEL – ten sam model służy do zapisu dokumentów i do pytań.
// Model embeddingów: openrouter.textEmbeddingModel(...) (typy @openrouter/ai-sdk-provider 3.1.0),
// użycie z embed / embedMany z pakietu "ai" (node_modules/ai/docs/03-ai-sdk-core/30-embeddings.mdx).

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embedMany } from "ai";

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return apiKey ? createOpenRouter({ apiKey }) : null;
}

// Model rozmowy (null = brak konfiguracji w .env.local).
export function getChatModel() {
  const openrouter = getOpenRouter();
  const modelId = process.env.OPENROUTER_MODEL;
  return openrouter && modelId ? openrouter(modelId) : null;
}

// Model embeddingów (null = brak konfiguracji w .env.local).
// Sprawdzone 19.11.2026 (lekcja 6, W1 Standard): model openai/text-embedding-3-small, długość embeddingu 1536
// – zgodna z kolumną chunks.embedding vector(1536) i funkcją match_chunks.
export function getEmbeddingModel() {
  const openrouter = getOpenRouter();
  const modelId = process.env.OPENROUTER_EMBEDDING_MODEL;
  return openrouter && modelId ? openrouter.textEmbeddingModel(modelId) : null;
}

// Lekcja 6, Warsztat 2 (krok B): embeddingi wielu tekstów JEDNYM wywołaniem (embedMany).
// null = brak modelu embeddingów w .env.local. Wyniki w tej samej kolejności co teksty.
export function getEmbedder(): ((values: string[]) => Promise<number[][]>) | null {
  const model = getEmbeddingModel();
  if (!model) return null;
  return async (values) => {
    const { embeddings } = await embedMany({ model, values });
    return embeddings;
  };
}
