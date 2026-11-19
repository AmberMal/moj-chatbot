"use client";

import { useState, type FormEvent } from "react";
import { KNOWLEDGE_MESSAGES, MAX_CONTENT_CHARS, MAX_TITLE_CHARS, UPLOAD_API, checkUploadInput } from "@/lib/amber-knowledge";

// Lekcja 6, Warsztat 2 (Minimum, krok A): formularz „Tytuł” + „Treść” → /api/upload.
export default function UploadForm() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const check = checkUploadInput({ tytul: title, tresc: content });
    if (!check.ok) {
      // Pusty tytuł albo pusta treść – komunikat od razu, bez wysyłania.
      setMessage({ kind: "error", text: check.komunikat });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(UPLOAD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tytul: title, tresc: content }),
      });
      const data: unknown = await response.json().catch(() => null);
      const text = (data as { komunikat?: unknown } | null)?.komunikat;
      if (!response.ok) {
        setMessage({ kind: "error", text: typeof text === "string" ? text : KNOWLEDGE_MESSAGES.saveError });
        return;
      }
      setMessage({ kind: "ok", text: typeof text === "string" ? text : "Zapisano dokument." });
      setTitle("");
      setContent("");
    } catch {
      setMessage({ kind: "error", text: KNOWLEDGE_MESSAGES.connection });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-card upload-form" onSubmit={submit} noValidate>
      <label className="profile-label" htmlFor="upload-title">
        Tytuł
      </label>
      <input id="upload-title" type="text" value={title} maxLength={MAX_TITLE_CHARS} onChange={(e) => setTitle(e.target.value)} />
      <label className="profile-label" htmlFor="upload-content">
        Treść
      </label>
      <textarea id="upload-content" rows={16} value={content} maxLength={MAX_CONTENT_CHARS} onChange={(e) => setContent(e.target.value)} />
      <p className="hint">
        {content.length} / {MAX_CONTENT_CHARS} znaków. Każdy akapit (tekst oddzielony pustą linią) to osobny fragment.
      </p>
      <button type="submit" className="logout" disabled={busy}>
        Dodaj do bazy wiedzy
      </button>
      {message && (
        <p className={message.kind === "ok" ? "profile-ok" : "error"} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </form>
  );
}
