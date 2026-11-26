"use client";

import { useState, type FormEvent } from "react";

// Lekcja 8, Warsztat 1: formularz misji i karty wyników. Tylko podgląd i „Kopiuj szkic” – bez wysyłania.
type Card =
  | { ok: true; numer: number; nadawca: string; temat: string; kategoria: string; priorytet: string; uzasadnienie: string; szkic: string }
  | { ok: false; numer: number; komunikat: string; podglad: string };

function readCards(data: unknown): Card[] | null {
  const karty = (data as { karty?: unknown } | null)?.karty;
  return Array.isArray(karty) ? (karty as Card[]) : null;
}

export default function TriageForm() {
  const [text, setText] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !text.trim()) return;
    setPending(true);
    setError("");
    setCards([]);
    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tekst: text }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError((data as { komunikat?: string } | null)?.komunikat ?? "Nie udało się posortować maili.");
        return;
      }
      const result = readCards(data);
      if (!result) setError("Serwer zwrócił nieoczekiwaną odpowiedź.");
      else setCards(result);
    } catch {
      setError("Brak połączenia z serwerem.");
    } finally {
      setPending(false);
    }
  }

  async function copy(card: Extract<Card, { ok: true }>) {
    try {
      await navigator.clipboard.writeText(card.szkic);
      setCopied(card.numer);
      setTimeout(() => setCopied((current) => (current === card.numer ? null : current)), 2000);
    } catch {
      setError("Nie udało się skopiować – zaznacz szkic i skopiuj ręcznie (Cmd+C).");
    }
  }

  return (
    <>
      <form className="triage-form" onSubmit={handleSubmit} aria-busy={pending}>
        <label htmlFor="emails">Maile</label>
        <textarea
          id="emails"
          rows={14}
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          placeholder={"Od: …\nTemat: …\nTreść maila…\n---\nOd: …\nTemat: …\nTreść kolejnego maila…"}
        />
        <button type="submit" className="auth-submit" disabled={pending || !text.trim()}>
          {pending ? "Agent sortuje…" : "Posortuj"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {cards.length > 0 && (
        <ol className="triage-cards">
          {cards.map((card) =>
            card.ok ? (
              <li key={card.numer} className="triage-card">
                <div className="triage-head">
                  <span className="triage-from">{card.nadawca}</span>
                  <span className="triage-subject">{card.temat}</span>
                </div>
                <div className="triage-tags">
                  <span className="pill">{card.kategoria}</span>
                  <span className={`pill priority-${card.priorytet === "wysoki" ? "high" : card.priorytet === "średni" ? "mid" : "low"}`}>
                    priorytet: {card.priorytet}
                  </span>
                </div>
                <p className="triage-reason">{card.uzasadnienie}</p>
                <div className="triage-draft">{card.szkic}</div>
                <button type="button" className="logout" onClick={() => copy(card)}>
                  {copied === card.numer ? "Skopiowano ✓" : "Kopiuj szkic"}
                </button>
              </li>
            ) : (
              <li key={card.numer} className="triage-card triage-failed">
                <div className="triage-head">
                  <span className="triage-from">Mail {card.numer}</span>
                  {card.podglad && <span className="triage-subject">{card.podglad}</span>}
                </div>
                <p className="error" role="alert">
                  {card.komunikat}
                </p>
              </li>
            ),
          )}
        </ol>
      )}
    </>
  );
}
