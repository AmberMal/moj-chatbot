"use client";

import { useState, type FormEvent } from "react";
import {
  KNOWLEDGE_MESSAGES,
  MAX_CONTENT_CHARS,
  MAX_TITLE_CHARS,
  SPLIT_MODES,
  STAGE_PROGRESS,
  UPLOAD_API,
  checkUploadInput,
  deleteQuestion,
  formatAddedAt,
  interruptedMessage,
  replaceQuestion,
  type DocumentSummary,
  type SplitMode,
  type UploadEvent,
  type UploadStage,
} from "@/lib/amber-knowledge";

type Message = { kind: "ok" | "error" | "progress"; text: string; extra?: string };

// Lekcja 6, Warsztat 2: formularz „Tytuł” + „Treść” → /api/upload.
// Standard: postęp importu, blokada przycisku, lista dokumentów, zastępowanie po tytule, „Usuń”.
// Dla szybkich (wyzwanie): wybór sposobu dzielenia tekstu – domyślnie „akapity”.
// 27.11 (wygląd, wariant A): na górze „+ Dodaj dokument” (rozwija formularz), pod spodem tabela dokumentów.
export default function UploadForm({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<SplitMode>("akapity");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>(initialDocuments);
  // Formularz zawsze zwinięty na start – rozwija go przycisk „+ Dodaj dokument” (decyzja Malwiny 27.11).
  const [formOpen, setFormOpen] = useState(false);

  async function refreshList() {
    try {
      const response = await fetch(UPLOAD_API, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { dokumenty?: DocumentSummary[] } | null;
      if (response.ok && Array.isArray(data?.dokumenty)) setDocuments(data.dokumenty);
    } catch {
      // lista zostaje jak była – komunikat importu już powiedział, co się stało
    }
  }

  async function sendDocument(replace: boolean): Promise<"done" | "exists"> {
    let stage: UploadStage | null = null;
    try {
      const response = await fetch(UPLOAD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tytul: title, tresc: content, zastap: replace, podzial: mode }),
      });
      if (!(response.headers.get("Content-Type") ?? "").includes("ndjson") || !response.body) {
        // Odpowiedź bez postępu: 401, 400, 409 (ten sam tytuł) albo 503.
        const data = (await response.json().catch(() => null)) as { komunikat?: unknown; istnieje?: unknown } | null;
        if (response.status === 409 && data?.istnieje === true) return "exists";
        const text = typeof data?.komunikat === "string" ? data.komunikat : interruptedMessage(null);
        setMessage({ kind: "error", text });
        return "done";
      }

      // Postęp: każda linia to jedno zdarzenie JSON.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as UploadEvent;
          if (event.typ === "etap") {
            stage = event.etap;
            setMessage({ kind: "progress", text: STAGE_PROGRESS[event.etap] });
          } else if (event.typ === "gotowe") {
            finished = true;
            setMessage({ kind: "ok", text: event.komunikat, extra: event.ostrzezenie });
            setTitle("");
            setContent("");
          } else {
            finished = true;
            setMessage({ kind: "error", text: event.komunikat });
          }
        }
        if (done) break;
      }
      if (!finished) setMessage({ kind: "error", text: interruptedMessage(stage) });
    } catch {
      setMessage({ kind: "error", text: stage ? interruptedMessage(stage) : KNOWLEDGE_MESSAGES.connection });
    }
    return "done";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const check = checkUploadInput({ tytul: title, tresc: content });
    if (!check.ok) {
      // Pusty tytuł albo pusta treść – komunikat od razu, bez wysyłania.
      setMessage({ kind: "error", text: check.komunikat });
      return;
    }
    // Ten sam tytuł na liście – pytamy o zastąpienie, zanim cokolwiek wyślemy.
    let replace = false;
    if (documents.some((doc) => doc.title === check.title)) {
      if (!window.confirm(replaceQuestion(check.title))) return;
      replace = true;
    }
    setBusy(true);
    setMessage({ kind: "progress", text: STAGE_PROGRESS.split });
    try {
      let result = await sendDocument(replace);
      // Serwer znalazł ten sam tytuł (np. dodany w innej karcie) – też pytamy.
      if (result === "exists") {
        if (window.confirm(replaceQuestion(check.title))) {
          setMessage({ kind: "progress", text: STAGE_PROGRESS.split });
          result = await sendDocument(true);
        } else {
          setMessage(null);
        }
      }
      await refreshList();
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: DocumentSummary) {
    if (busy || !window.confirm(deleteQuestion(doc.title, doc.chunks))) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(UPLOAD_API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });
      const data = (await response.json().catch(() => null)) as { komunikat?: unknown; dokumenty?: DocumentSummary[] } | null;
      if (!response.ok) {
        setMessage({ kind: "error", text: typeof data?.komunikat === "string" ? data.komunikat : KNOWLEDGE_MESSAGES.deleteError });
        return;
      }
      setMessage({ kind: "ok", text: `Usunięto dokument „${doc.title}”.` });
      if (Array.isArray(data?.dokumenty)) setDocuments(data.dokumenty);
      else await refreshList();
    } catch {
      setMessage({ kind: "error", text: KNOWLEDGE_MESSAGES.connection });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="logout upload-add"
        aria-expanded={formOpen}
        aria-controls="upload-form"
        disabled={busy}
        onClick={() => setFormOpen((open) => !open)}
      >
        {formOpen ? "× Zwiń formularz" : "+ Dodaj dokument"}
      </button>

      {formOpen && (
      <form id="upload-form" className="profile-card upload-form" onSubmit={submit} noValidate>
        <label className="profile-label" htmlFor="upload-title">
          Tytuł
        </label>
        <input id="upload-title" type="text" value={title} maxLength={MAX_TITLE_CHARS} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        <label className="profile-label" htmlFor="upload-content">
          Treść
        </label>
        <textarea id="upload-content" rows={16} value={content} maxLength={MAX_CONTENT_CHARS} disabled={busy} onChange={(e) => setContent(e.target.value)} />
        <p className="hint">
          {content.length} / {MAX_CONTENT_CHARS} znaków.{" "}
          {mode === "akapity"
            ? "Każdy akapit (tekst oddzielony pustą linią) to osobny fragment."
            : "Tekst zostanie pocięty na kawałki po 300 znaków, każdy zaczyna się 50 znaków przed końcem poprzedniego."}
        </p>
        <fieldset className="upload-mode" disabled={busy}>
          <legend className="profile-label">Sposób dzielenia tekstu</legend>
          {SPLIT_MODES.map((option) => (
            <label key={option.value}>
              <input type="radio" name="podzial" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} />{" "}
              {option.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="logout" disabled={busy}>
          Dodaj do bazy wiedzy
        </button>
        {message && (
          <div
            className={message.kind === "ok" ? "profile-ok" : message.kind === "error" ? "error" : "upload-progress"}
            role={message.kind === "error" ? "alert" : "status"}
          >
            <p>{message.text}</p>
            {message.extra && <p>{message.extra}</p>}
          </div>
        )}
      </form>
      )}

      {/* Komunikat po usunięciu dokumentu, gdy formularz jest zwinięty */}
      {!formOpen && message && (
        <div className={message.kind === "error" ? "error" : "profile-ok"} role={message.kind === "error" ? "alert" : "status"}>
          <p>{message.text}</p>
          {message.extra && <p>{message.extra}</p>}
        </div>
      )}

      <section className="profile-card">
        <h2>Dokumenty w bazie wiedzy</h2>
        {documents.length === 0 ? (
          <p className="hint upload-empty">Baza wiedzy jest pusta. Kliknij „+ Dodaj dokument” powyżej.</p>
        ) : (
          <table className="upload-table">
            <thead>
              <tr>
                <th scope="col">Tytuł</th>
                <th scope="col">Fragmenty</th>
                <th scope="col">Dodano</th>
                <th scope="col">
                  <span className="sr-only">Usuń</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="history-title">{doc.title}</td>
                  <td>{doc.chunks}</td>
                  <td>{formatAddedAt(doc.createdAt)}</td>
                  <td>
                    <button type="button" className="history-delete" disabled={busy} onClick={() => void remove(doc)}>
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
