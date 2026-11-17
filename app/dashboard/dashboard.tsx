"use client";

import { useState, type FormEvent } from "react";

// Lekcja 4, Warsztat 3 (Minimum/Standard): jedno miasto, 5 kart, „Odśwież” i podsumowanie agenta.
// Poziom Fast: tryb „Porównaj” – dwa miasta, wspólna data, karty obok siebie i rekomendacja jednego miasta.
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
type SingleResult = { miasto: string; kraj: string; data: string; karty: Card[]; podsumowanie: string | null };
type CompareCity = { miasto: string; kraj: string; karty: Card[] };
type CompareResult = {
  tryb: "porownanie";
  data: string;
  miasta: [CompareCity, CompareCity];
  rekomendacja: { miasto: string; uzasadnienie: string } | null;
};
type Result = SingleResult | CompareResult;
type Query = { miasto: string; miasto2?: string; data: string };

// Standard: tytuły kart do stanu „Ładuję…” (ta sama kolejność co na serwerze).
const CARD_TITLES = ["Pogoda", "Waluty", "Święta", "Wikipedia", "Czas"];
const MISSING_TEXT = "Brak danych — spróbuj odświeżyć";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const isCompare = (r: Result): r is CompareResult => "tryb" in r && r.tryb === "porownanie";
const isValidResult = (b: unknown): b is Result =>
  typeof b === "object" &&
  b !== null &&
  (Array.isArray((b as SingleResult).karty) ||
    (Array.isArray((b as CompareResult).miasta) && (b as CompareResult).miasta.every((m) => Array.isArray(m?.karty))));

function Cards({ karty }: { karty: Card[] | null }) {
  return (
    <div className="cards">
      {!karty
        ? CARD_TITLES.map((title) => (
            <article key={title} className="card card-loading">
              <h3>
                {title} <span className="card-state state-loading">Ładuję…</span>
              </h3>
              <p className="card-details">Ładuję…</p>
            </article>
          ))
        : karty.map((card) => (
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
  );
}

export default function Dashboard() {
  const [porownaj, setPorownaj] = useState(false);
  const [miasto, setMiasto] = useState("");
  const [miasto2, setMiasto2] = useState("");
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
      if (!response.ok || !isValidResult(body)) {
        // Bez danych zastępczych: poprzednie karty nie zostają na ekranie.
        setResult(null);
        setError(typeof body?.error === "string" ? body.error : "Nie udało się pobrać danych. Spróbuj ponownie.");
        return;
      }
      setResult(body);
    } catch {
      setResult(null);
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: boolean) {
    if (pending || next === porownaj) return;
    setPorownaj(next);
    setResult(null);
    setLastQuery(null);
    setError("");
  }

  const ready = Boolean(miasto.trim() && data && (!porownaj || miasto2.trim()));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    load(porownaj ? { miasto: miasto.trim(), miasto2: miasto2.trim(), data } : { miasto: miasto.trim(), data });
  }

  const shown = result && !pending ? result : null;
  const compareView = lastQuery?.miasto2 !== undefined;

  let title = "";
  if (lastQuery) {
    if (shown && isCompare(shown)) title = `${shown.miasta[0].miasto} vs ${shown.miasta[1].miasto} – ${dmy(shown.data)}`;
    else if (shown && !isCompare(shown)) title = `${shown.miasto}${shown.kraj ? `, ${shown.kraj}` : ""} – ${dmy(shown.data)}`;
    else title = `${lastQuery.miasto}${compareView ? ` vs ${lastQuery.miasto2}` : ""} – ${dmy(lastQuery.data)}`;
  }

  return (
    <>
      <div className="mode-switch" role="group" aria-label="Tryb dashboardu">
        <button type="button" className={porownaj ? "" : "active"} aria-pressed={!porownaj} disabled={pending} onClick={() => switchMode(false)}>
          Jedno miasto
        </button>
        <button type="button" className={porownaj ? "active" : ""} aria-pressed={porownaj} disabled={pending} onClick={() => switchMode(true)}>
          Porównaj
        </button>
      </div>

      <form className="trip-form" onSubmit={handleSubmit}>
        <label>
          {porownaj ? "Pierwsze miasto" : "Dokąd jedziesz?"}
          <input value={miasto} onChange={(e) => setMiasto(e.target.value)} maxLength={100} placeholder="np. Londyn" />
        </label>
        {porownaj && (
          <label>
            Drugie miasto
            <input value={miasto2} onChange={(e) => setMiasto2(e.target.value)} maxLength={100} placeholder="np. Paryż" />
          </label>
        )}
        <label>
          {porownaj ? "Wspólna data" : "Kiedy?"}
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <button type="submit" disabled={pending || !ready}>
          {pending ? "Sprawdzam…" : porownaj ? "Porównaj" : "Sprawdź"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {(pending || result) && lastQuery && (
        <section className="trip-result">
          <div className="trip-header">
            <h2>{title}</h2>
            <button type="button" className="logout" disabled={pending} onClick={() => load(lastQuery)}>
              {pending ? "Odświeżam…" : "Odśwież"}
            </button>
          </div>

          {compareView ? (
            <>
              <div className="compare-columns">
                {[0, 1].map((i) => {
                  const city = shown && isCompare(shown) ? shown.miasta[i] : null;
                  const name = city ? `${city.miasto}${city.kraj ? `, ${city.kraj}` : ""}` : i === 0 ? lastQuery.miasto : lastQuery.miasto2;
                  const recommended = Boolean(city && shown && isCompare(shown) && shown.rekomendacja?.miasto === city.miasto);
                  return (
                    <div key={i} className={`compare-column${recommended ? " recommended" : ""}`}>
                      <h3 className="compare-city">
                        {name}
                        {recommended && <span className="card-state state-ok">Polecane</span>}
                      </h3>
                      <Cards karty={city ? city.karty : null} />
                    </div>
                  );
                })}
              </div>
              <div className="trip-summary">
                <strong>Rekomendacja Amber</strong>
                {!shown || !isCompare(shown) ? (
                  <p>Ładuję…</p>
                ) : shown.rekomendacja ? (
                  <>
                    <p className="recommendation-city">Polecam: {shown.rekomendacja.miasto}</p>
                    <p>{shown.rekomendacja.uzasadnienie}</p>
                  </>
                ) : (
                  <p>Rekomendacja niedostępna</p>
                )}
              </div>
            </>
          ) : (
            <>
              <Cards karty={shown && !isCompare(shown) ? shown.karty : null} />
              <div className="trip-summary">
                <strong>Podsumowanie Amber</strong>
                <p>{!shown || isCompare(shown) ? "Ładuję…" : (shown.podsumowanie ?? "Podsumowanie niedostępne")}</p>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
