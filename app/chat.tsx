"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, type ChangeEvent, type FormEvent } from "react";

// Limit długości wiadomości klienta – taki sam jak na serwerze (lib/amber-history.ts).
const MAX_MESSAGE_CHARS = 4000;
// Informacja o limicie pokazuje się dopiero przy długiej wiadomości.
const SHOW_LIMIT_FROM = 3500;

// Lekcja 3: etykiety użytych narzędzi (nad odpowiedzią Amber).
const TOOL_LABELS: Record<string, string> = {
  wyszukiwanie: "🔎 wyszukiwanie",
  aktualnyCzas: "🕒 aktualnyCzas",
  sprawdzObszar: "📍 sprawdzObszar",
  informacjeOUrzadzeniu: "🔧 informacjeOUrzadzeniu",
};

// Lekcja 3 (Vision): zdjęcia jpg/png/webp do 4 MB. Przed wysłaniem przeglądarka
// zmniejsza zdjęcie (maks. 1600 px, JPEG), żeby zmieściło się w limitach serwera.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const MAX_IMAGE_DATA_URL_CHARS = 3_000_000; // taki sam limit jak na serwerze (lib/amber-history.ts)

type PendingImage = { url: string; name: string };

// Lekcja 3 (B): wygenerowane obrazy są widoczne tylko w tym oknie –
// nie trafiają do historii rozmowy z Amber (nie psują podpisów i nie zwiększają kosztów).
const MAX_IMAGE_PROMPT_CHARS = 500; // taki sam limit jak na serwerze (lib/amber-image.ts)
// Klikalne podpowiedzi opisów obrazu (wpisują tekst do pola – nie wysyłają, bo generowanie jest płatne).
const IMAGE_PROMPT_SUGGESTIONS = [
  "Plakat: dom chroniony systemem alarmowym, nowoczesny styl, kolory bursztynowy i grafitowy",
  "Zdjęcie produktowe: nowoczesna klawiatura alarmu na białej ścianie w jasnym korytarzu",
  "Grafika do social media: kamera CCTV na elewacji londyńskiej kamienicy o zmierzchu",
];

// Nazwa pobieranego pliku, np. amber-obraz-2026-11-10-1945.png
function downloadName(item: GeneratedImage): string {
  const d = item.createdAt;
  const pad = (n: number) => String(n).padStart(2, "0");
  const ext = item.url?.startsWith("data:image/jpeg") ? "jpg" : item.url?.startsWith("data:image/webp") ? "webp" : "png";
  return `amber-obraz-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

type GeneratedImage = {
  id: string;
  afterCount: number; // liczba wiadomości czatu w chwili wysłania – miejsce w rozmowie
  prompt: string;
  status: "loading" | "done" | "error";
  createdAt: Date;
  url?: string;
  model?: string;
  error?: string;
};

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff"; // tło dla przezroczystych PNG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Pełne zdjęcie wysyłamy tylko w najnowszych wiadomościach (po ostatniej odpowiedzi Amber).
// W starszych zostaje sam tekst – miniatura nadal jest widoczna w oknie czatu.
function withoutOldImages(messages: UIMessage[]): UIMessage[] {
  const lastAssistant = messages.map((message) => message.role).lastIndexOf("assistant");
  return messages.map((message, index) => {
    if (index > lastAssistant || message.role !== "user") return message;
    const parts = message.parts.filter((part) => part.type !== "file");
    return { ...message, parts: parts.length > 0 ? parts : [{ type: "text" as const, text: "" }] };
  });
}

const transport = new DefaultChatTransport<UIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
    body: { ...body, id, messages: withoutOldImages(messages), trigger, messageId },
  }),
});

export default function Chat() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generated, setGenerated] = useState<GeneratedImage[]>([]);
  const isGenerating = generated.some((item) => item.status === "loading");
  // useChat wysyła historię rozmowy do /api/chat i odbiera odpowiedź strumieniowo.
  const { messages, sendMessage, status, error, clearError, stop } = useChat({ transport });

  const isBusy = status === "submitted" || status === "streaming";
  // Gdy Amber pisze albo trwa generowanie obrazu – wszystkie przyciski są zablokowane.
  const isLocked = isBusy || isGenerating;
  const canSend = (input.trim().length > 0 || pendingImage !== null) && !isLocked;
  const canGenerate =
    input.trim().length > 0 && input.trim().length <= MAX_IMAGE_PROMPT_CHARS && !isBusy && !isGenerating;

  async function handleGenerateImage() {
    const prompt = input.trim();
    if (!canGenerate) return;
    const id = `img-${Date.now()}`;
    const update = (patch: Partial<GeneratedImage>) =>
      setGenerated((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setGenerated((items) => [...items, { id, afterCount: messages.length, prompt, status: "loading", createdAt: new Date() }]);
    setInput("");
    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json().catch(() => ({}))) as { image?: unknown; model?: unknown; error?: unknown };
      if (response.ok && typeof data.image === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(data.image)) {
        update({ status: "done", url: data.image, model: typeof data.model === "string" ? data.model : undefined });
      } else if (response.status === 401) {
        update({ status: "error", error: "Sesja wygasła. Zaloguj się ponownie." });
      } else {
        update({
          status: "error",
          error: typeof data.error === "string" ? data.error : "Model obrazów jest teraz niedostępny. Spróbuj ponownie za chwilę.",
        });
      }
    } catch {
      update({ status: "error", error: "Brak połączenia z serwerem. Spróbuj ponownie." });
    }
  }

  // Wygenerowane obrazy w miejscu rozmowy, w którym o nie poproszono.
  function generatedAfter(count: number) {
    return generated
      .filter((item) => item.afterCount === count)
      .map((item) => (
        <Fragment key={item.id}>
          <div className="message user">
            <span className="image-request">🎨 Wygeneruj obraz: </span>
            <span>{item.prompt}</span>
          </div>
          <div className={`message assistant${item.status === "loading" ? " pending" : ""}`}>
            {item.status === "loading" && "Generuję obraz…"}
            {item.status === "error" && <span className="image-error">{item.error}</span>}
            {item.status === "done" && item.url && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="generated" src={item.url} alt={`Wygenerowany obraz: ${item.prompt}`} />
                <div className="image-footer">
                  {item.model && <small className="model-id">model: {item.model}</small>}
                  <a className="download" href={item.url} download={downloadName(item)}>
                    Pobierz
                  </a>
                </div>
              </>
            )}
          </div>
        </Fragment>
      ));
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // pozwala wybrać ten sam plik ponownie
    setImageError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Można dodać tylko zdjęcie JPG, PNG lub WEBP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Zdjęcie jest za duże (maksymalnie 4 MB).");
      return;
    }
    try {
      const url = await compressImage(file);
      if (url.length > MAX_IMAGE_DATA_URL_CHARS) {
        setImageError("Nie udało się wystarczająco zmniejszyć zdjęcia. Spróbuj innego pliku.");
        return;
      }
      setPendingImage({ url, name: file.name });
    } catch {
      setImageError("Nie udało się odczytać zdjęcia. Spróbuj innego pliku.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !pendingImage) || isLocked) return; // blokada pustych wiadomości
    if (error) clearError();
    if (pendingImage) {
      sendMessage({
        text,
        files: [{ type: "file", mediaType: "image/jpeg", url: pendingImage.url, filename: pendingImage.name }],
      });
      setPendingImage(null);
    } else {
      sendMessage({ text });
    }
    setInput("");
  }

  // Wyjście: serwer usuwa cookie z sesją, a strona wraca do ekranu hasła.
  async function handleLogout() {
    stop();
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="logout" onClick={handleLogout}>
          Wyjdź
        </button>
      </div>

      <div className="messages" aria-label="Rozmowa" aria-live="polite">
        {messages.length === 0 && generated.length === 0 && (
          <p className="hint">Napisz pierwszą wiadomość, aby zacząć rozmowę.</p>
        )}

        {generatedAfter(0)}

        {messages.map((message, index) => {
          // Lekcja 3: źródła z wyszukiwania (tylko adresy http/https).
          const sources = message.parts.filter(
            (part) => part.type === "source-url" && /^https?:\/\//i.test(part.url),
          );
          const meta = message.metadata as
            | { fetchedAt?: string; tools?: string[]; model?: string }
            | undefined;
          const fetchedAt = meta?.fetchedAt;
          const toolLabels = Array.isArray(meta?.tools)
            ? meta.tools.filter((name) => name in TOOL_LABELS).map((name) => TOOL_LABELS[name])
            : [];
          return (
            <Fragment key={message.id}>
            <div className={`message ${message.role}`}>
              {message.role === "assistant" && toolLabels.length > 0 && (
                <div className="tool-labels">
                  {toolLabels.map((label) => (
                    <span key={label} className="tool-label">
                      {label}
                    </span>
                  ))}
                </div>
              )}
              {message.parts.map((part, i) => {
                if (part.type === "text") return <span key={i}>{part.text}</span>;
                // Lekcja 3 (Vision): miniatura wysłanego zdjęcia.
                if (
                  part.type === "file" &&
                  message.role === "user" &&
                  /^data:image\/(jpeg|png|webp);base64,/.test(part.url)
                ) {
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img key={i} className="thumb" src={part.url} alt={part.filename || "Wysłane zdjęcie"} />;
                }
                return null;
              })}
              {message.role === "assistant" && sources.length > 0 && (
                <div className="sources">
                  <strong>Źródła</strong>
                  <ul>
                    {sources.map((part, i) =>
                      part.type === "source-url" ? (
                        <li key={i}>
                          <a href={part.url} target="_blank" rel="noopener noreferrer">
                            {part.title || part.url}
                          </a>
                        </li>
                      ) : null,
                    )}
                  </ul>
                  {fetchedAt && <small>pobrano: {fetchedAt}</small>}
                </div>
              )}
              {message.role === "assistant" && meta?.model && (
                <small className="model-id">model: {meta.model}</small>
              )}
            </div>
            {generatedAfter(index + 1)}
            </Fragment>
          );
        })}

        {status === "submitted" && (
          <div className="message assistant pending">Model pisze…</div>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}

      {pendingImage && (
        <div className="pending-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb" src={pendingImage.url} alt={pendingImage.name} />
          <span>{pendingImage.name}</span>
          <button type="button" onClick={() => setPendingImage(null)} aria-label="Usuń zdjęcie">
            ✕
          </button>
        </div>
      )}
      {imageError && (
        <p className="error" role="alert">
          {imageError}
        </p>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleImageChange}
        />
        <button
          type="button"
          className="secondary"
          disabled={isLocked}
          onClick={() => fileInputRef.current?.click()}
        >
          Dodaj zdjęcie
        </button>
        <input
          type="text"
          placeholder="Napisz wiadomość..."
          aria-label="Wiadomość"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!canSend}>
          {isBusy ? "Czekaj…" : "Wyślij"}
        </button>
        <button type="button" className="secondary" disabled={!canGenerate} onClick={handleGenerateImage}>
          {isGenerating ? "Generuję…" : "Wygeneruj obraz"}
        </button>
      </form>

      <div className="suggestions" aria-label="Podpowiedzi opisów obrazu">
        <span>Pomysły na obraz:</span>
        {IMAGE_PROMPT_SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" disabled={isLocked} onClick={() => setInput(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      {input.trim().length > MAX_IMAGE_PROMPT_CHARS && input.length < SHOW_LIMIT_FROM && (
        <p className="hint" aria-live="polite">
          „Wygeneruj obraz”: opis może mieć maksymalnie {MAX_IMAGE_PROMPT_CHARS} znaków (teraz: {input.trim().length}).
        </p>
      )}

      {input.length >= SHOW_LIMIT_FROM && (
        <p className="hint" aria-live="polite">
          {input.length >= MAX_MESSAGE_CHARS
            ? `Osiągnięto limit ${MAX_MESSAGE_CHARS} znaków.`
            : `Limit wiadomości: ${input.length} / ${MAX_MESSAGE_CHARS} znaków.`}
        </p>
      )}
    </>
  );
}
