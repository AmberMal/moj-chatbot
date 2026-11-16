"use client";

import { useState, type FormEvent } from "react";

// Lekcja 4, Warsztat 3 (Minimum): jedno miasto, 5 kart, „Odśwież” i podsumowanie agenta.
type Card = {
  id: string;
  tytul: string;
  ok: boolean;
  stan: "ok" | "brak_danych";
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

// Standard: tytuły kart do stanu „Ładuję…” (ta sama kolejność co na serwerze).
const CARD_TITLES = ["Pogoda", "Waluty", "Święta", "Wikipedia", "Czas"];
const MISSING_TEXT = "Brak danych — spróbuj odświeżyć";

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
    setLastQuery(query);
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !Array.isArray(body.karty)) {
        // Bez danych zastępczych: poprzednie karty nie zostają na ekranie.
        setResult(null);
        setError(typeof body?.error === "string" ? body.error : "Nie udało się pobrać danych. Spróbuj ponownie.");
        return;
      }
      setResult(body as Result);
    } catch {
      setResult(null);
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

      {(pending || result) && lastQuery && (
        <section className="trip-result">
          <div className="trip-header">
            <h2>
              {result && !pending ? `${result.miasto}${result.kraj ? `, ${result.kraj}` : ""}` : lastQuery.miasto} –{" "}
              {(result && !pending ? result.data : lastQuery.data).split("-").reverse().join(".")}
            </h2>
            <button type="button" className="logout" disabled={pending} onClick={() => load(lastQuery)}>
              {pending ? "Odświeżam…" : "Odśwież"}
            </button>
          </div>

          <div className="cards">
            {pending || !result
              ? CARD_TITLES.map((title) => (
                  <article key={title} className="card card-loading">
                    <h3>
                      {title} <span className="card-state state-loading">Ładuję…</span>
                    </h3>
                    <p className="card-details">Ładuję…</p>
                  </article>
                ))
              : result.karty.map((card) => (
                  <article key={card.id} className={`card${card.stan === "ok" ? "" : " card-error"}`}>
                    <h3>
                      {card.tytul}{" "}
                      {card.stan === "ok" ? (
                        <span className="card-state state-ok">OK</span>
                      ) : (
                        <span className="card-state state-missing">Brak danych</span>
                      )}
                    </h3>
                    {card.stan === "ok" ? (
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
                      <>
                        <p className="card-details card-missing">{MISSING_TEXT}</p>
                        {card.komunikat && <small className="card-reason">{card.komunikat}</small>}
                      </>
                    )}
                    <small>
                      Źródło: {card.zrodlo} · pobrano: {card.pobrano}
                    </small>
                  </article>
                ))}
          </div>

          <div className="trip-summary">
            <strong>Podsumowanie Amber</strong>
            <p>{pending || !result ? "Ładuję…" : (result.podsumowanie ?? "Podsumowanie niedostępne")}</p>
          </div>
        </section>
      )}
    </>
  );
}
