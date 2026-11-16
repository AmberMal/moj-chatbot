"use client";

import { useState, type FormEvent } from "react";

// Lekcja 4, Warsztat 3 (Minimum): jedno miasto, 5 kart, „Odśwież” i podsumowanie agenta.
type Card = {
  id: string;
  tytul: string;
  ok: boolean;
  wartosc: string;
  jednostka?: string;
  szczegoly?: string;
  komunikat?: string;
  link?: string;
  zrodlo: string;
  pobrano: string;
};
type Result = { miasto: string; kraj: string; data: string; karty: Card[]; podsumowanie: string | null };
type Query = { miasto: string; data: string };

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [miasto, setMiasto] = useState("");
  const [data, setData] = useState(todayLocal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [lastQuery, setLastQuery] = useState<Query | null>(null);

  async function load(query: Query) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !Array.isArray(body.karty)) {
        setError(typeof body?.error === "string" ? body.error : "Nie udało się pobrać danych. Spróbuj ponownie.");
        return;
      }
      setResult(body as Result);
      setLastQuery(query);
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const city = miasto.trim();
    if (!city || !data) return;
    load({ miasto: city, data });
  }

  return (
    <>
      <form className="trip-form" onSubmit={handleSubmit}>
        <label>
          Dokąd jedziesz?
          <input value={miasto} onChange={(e) => setMiasto(e.target.value)} maxLength={100} placeholder="np. Londyn" />
        </label>
        <label>
          Kiedy?
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <button type="submit" disabled={pending || !miasto.trim() || !data}>
          {pending ? "Sprawdzam…" : "Sprawdź"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <section className="trip-result">
          <div className="trip-header">
            <h2>
              {result.miasto}
              {result.kraj ? `, ${result.kraj}` : ""} – {result.data.split("-").reverse().join(".")}
            </h2>
            <button type="button" className="logout" disabled={pending || !lastQuery} onClick={() => lastQuery && load(lastQuery)}>
              {pending ? "Odświeżam…" : "Odśwież"}
            </button>
          </div>

          <div className="cards">
            {result.karty.map((card) => (
              <article key={card.id} className={`card${card.ok ? "" : " card-error"}`}>
                <h3>{card.tytul}</h3>
                {card.ok ? (
                  <>
                    <p className="card-value">
                      {card.wartosc}
                      {card.jednostka ? ` ${card.jednostka}` : ""}
                    </p>
                    {card.szczegoly && <p className="card-details">{card.szczegoly}</p>}
                    {card.link && (
                      <a href={card.link} target="_blank" rel="noopener noreferrer">
                        Czytaj w Wikipedii
                      </a>
                    )}
                  </>
                ) : (
                  <p className="card-details">{card.komunikat}</p>
                )}
                <small>
                  Źródło: {card.zrodlo} · pobrano: {card.pobrano}
                </small>
              </article>
            ))}
          </div>

          <div className="trip-summary">
            <strong>Podsumowanie Amber</strong>
            <p>{result.podsumowanie ?? "Podsumowanie niedostępne"}</p>
          </div>
        </section>
      )}
    </>
  );
}
