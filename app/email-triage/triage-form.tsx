"use client";

import { useState, type FormEvent } from "react";
import { sortTriageCards, triageSummary } from "../../lib/amber-triage-view";

// Lekcja 8, Warsztat 1: formularz misji i karty wyników. Tylko podgląd i „Kopiuj szkic” – bez wysyłania.
type Card =
  | { ok: true; numer: number; nadawca: string; temat: string; kategoria: string; priorytet: string; uzasadnienie: string; szkic: string; zrodla: string[] }
  | { ok: false; numer: number; komunikat: string; podglad: string };

function readCards(data: unknown): Card[] | null {
  const karty = (data as { karty?: unknown } | null)?.karty;
  return Array.isArray(karty) ? (karty as Card[]) : null;
}

export default function TriageForm({ maxEmails }: { maxEmails: number }) {
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
      // Standard: od najwyższego priorytetu; przy tym samym – kolejność maili.
      else setCards(sortTriageCards(result));
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
        {/* 27.11 (wygląd, wariant 1): duże pole „Wklej maile tutaj” z podpowiedzią w środku */}
        <label htmlFor="emails" className="sr-only">
          Maile
        </label>
        <div className={`triage-drop${text ? " has-text" : ""}`}>
          <textarea id="emails" rows={12} value={text} disabled={pending} onChange={(event) => setText(event.target.value)} />
          {!text && (
            <div className="triage-drop-hint" aria-hidden="true">
              <span className="triage-drop-icon">✉</span>
              <strong>Wklej maile tutaj</strong>
              <span>oddzielone linią z trzema myślnikami (---), najwyżej {maxEmails}</span>
            </div>
          )}
        </div>
        <button type="submit" className="auth-submit triage-sort" disabled={pending || !text.trim()}>
          <span aria-hidden="true">✨ </span>
          {pending ? "Agent sortuje…" : "Posortuj"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {cards.length > 0 && (
        <TriageSummary cards={cards} />
      )}
      {cards.length > 0 && (
        <ol className="triage-cards">
          {cards.map((card) =>
            card.ok ? (
              // 27.11 (wygląd, wariant A): kolorowy pasek priorytetu z lewej, szkic rozwijany, „Kopiuj szkic” zawsze widoczny.
              <li key={card.numer} className={`triage-card prio-${priorityClass(card.priorytet)}`}>
                <div className="triage-top">
                  <div className="triage-head">
                    <span className="triage-from">{card.nadawca}</span>
                    <span className="triage-subject">{card.temat}</span>
                  </div>
                  <span className={`triage-prio pill priority-${priorityClass(card.priorytet)}`}>{card.priorytet}</span>
                </div>
                <p className="triage-meta">
                  <span className="triage-cat">{card.kategoria}</span> · {card.uzasadnienie}
                </p>
                <details className="triage-details">
                  <summary>Pokaż szkic</summary>
                  <div className="triage-draft">{card.szkic}</div>
                  {/* Standard: dokumenty z bazy wiedzy, z których szkic skorzystał */}
                  {Array.isArray(card.zrodla) &&
                    card.zrodla.map((title) => (
                      <p key={title} className="triage-source">
                        📎 Źródło: {title}
                      </p>
                    ))}
                </details>
                <button type="button" className="logout triage-copy" onClick={() => copy(card)}>
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

function priorityClass(priorytet: string): "high" | "mid" | "low" {
  return priorytet === "wysoki" ? "high" : priorytet === "średni" ? "mid" : "low";
}

// Standard: podsumowanie nad kartami – ile maili ma priorytet wysoki, średni i niski.
function TriageSummary({ cards }: { cards: Card[] }) {
  const summary = triageSummary(cards);
  return (
    <div className="triage-summary" aria-label="Podsumowanie priorytetów">
      <span className="pill priority-high">wysoki: {summary.wysoki}</span>
      <span className="pill priority-mid">średni: {summary.średni}</span>
      <span className="pill priority-low">niski: {summary.niski}</span>
      {summary.bledy > 0 && <span className="pill">nieudane: {summary.bledy}</span>}
    </div>
  );
}
