"use client";

import { useChat } from "@ai-sdk/react";
import { useState, type FormEvent } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  // useChat domyślnie wysyła całą historię rozmowy do /api/chat
  // i odbiera odpowiedź strumieniowo.
  const { messages, sendMessage, status, error, clearError } = useChat();

  const isBusy = status === "submitted" || status === "streaming";
  const canSend = input.trim().length > 0 && !isBusy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return; // blokada pustych wiadomości
    if (error) clearError();
    sendMessage({ text });
    setInput("");
  }

  return (
    <main className="chat">
      <h1>Mój chatbot</h1>

      <div className="messages" aria-label="Rozmowa" aria-live="polite">
        {messages.length === 0 && (
          <p className="hint">Napisz pierwszą wiadomość, aby zacząć rozmowę.</p>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            {message.parts.map((part, i) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null,
            )}
          </div>
        ))}

        {status === "submitted" && (
          <div className="message assistant pending">Model pisze…</div>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Napisz wiadomość..."
          aria-label="Wiadomość"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!canSend}>
          {isBusy ? "Czekaj…" : "Wyślij"}
        </button>
      </form>
    </main>
  );
}
