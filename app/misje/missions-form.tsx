"use client";

import { useState, type FormEvent } from "react";
import type { MissionReport, PublicMission } from "../../lib/amber-missions";

// Lekcja 8, Warsztat 2: wybór misji (Raport, Porównanie trzech firm), formularz z pól misji i raport. Tylko podgląd – bez zapisu i wysyłania.
function readReport(data: unknown): MissionReport | null {
  const raport = (data as { raport?: unknown } | null)?.raport as MissionReport | undefined;
  return raport && typeof raport.tytul === "string" && Array.isArray(raport.sekcje) ? raport : null;
}

// Data i godzina wykonania – w strefie czasowej przeglądarki, np. „26.11.2026, 18:50”.
function formatDone(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MissionsForm({ missions }: { missions: PublicMission[] }) {
  const [missionId, setMissionId] = useState(missions[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [report, setReport] = useState<MissionReport | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const mission = missions.find((m) => m.id === missionId);

  function choose(id: string) {
    if (pending) return;
    setMissionId(id);
    setValues({});
    setReport(null);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !mission) return;
    setPending(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ misja: mission.id, pola: values }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError((data as { komunikat?: string } | null)?.komunikat ?? "Misja się nie udała. Spróbuj ponownie.");
        return;
      }
      const result = readReport(data);
      if (!result) setError("Serwer zwrócił nieoczekiwaną odpowiedź.");
      else setReport(result);
    } catch {
      setError("Brak połączenia z serwerem.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="missions">
      <div className="mission-list" role="list">
        {missions.map((m) => (
          <button
            key={m.id}
            type="button"
            role="listitem"
            className={`mission-choice${m.id === missionId ? " active" : ""}`}
            onClick={() => choose(m.id)}
            disabled={pending}
          >
            <strong>{m.nazwa}</strong>
            <span>{m.opis}</span>
          </button>
        ))}
      </div>

      {mission && (
        <form className="triage-form" onSubmit={handleSubmit}>
          {mission.pola.map((field) => (
            <label key={field.name} className="mission-field">
              {field.label}
              <input
                type="text"
                value={values[field.name] ?? ""}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                disabled={pending}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
              <small>
                {field.hint ? `${field.hint} ` : ""}
                {(values[field.name] ?? "").length}/{field.maxLength}
              </small>
            </label>
          ))}
          <button type="submit" className="auth-submit" disabled={pending || mission.pola.some((f) => !(values[f.name] ?? "").trim())}>
            {pending ? "Agent pracuje…" : "Uruchom misję"}
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <article className="mission-report">
          <h2>{report.tytul}</h2>
          {report.sekcje.map((s) => (
            <section key={s.tytul}>
              <h3>{s.tytul}</h3>
              {s.typ === "tekst" && <p>{s.tekst}</p>}
              {s.typ === "lista" && (
                <ul>
                  {s.punkty.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {s.typ === "tabela" && (
                <div className="mission-table-wrap">
                  <table className="mission-table">
                    <thead>
                      <tr>
                        <th scope="col">Kryterium</th>
                        {s.kolumny.map((k) => (
                          <th key={k} scope="col">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.wiersze.map((w) => (
                        <tr key={w.kryterium}>
                          <th scope="row">{w.kryterium}</th>
                          {w.wartosci.map((v, i) => (
                            <td key={i} className={v === "brak danych" ? "no-data" : undefined}>
                              {v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {s.typ === "linki" &&
                (s.linki.length > 0 ? (
                  s.numerowane ? (
                    // Standard: ponumerowane źródła – numery w [ ] przy faktach wskazują pozycję na tej liście.
                    <ol className="mission-sources">
                      {s.linki.map((l, i) => (
                        <li key={l.url}>
                          [{i + 1}]{" "}
                          <a href={l.url} target="_blank" rel="noopener noreferrer">
                            {l.tytul}
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ul>
                      {s.linki.map((l) => (
                        <li key={l.url}>
                          <a href={l.url} target="_blank" rel="noopener noreferrer">
                            {l.tytul}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <p className="hint">{s.brak}</p>
                ))}
            </section>
          ))}
          {report.wykonano && <p className="mission-time">Misja wykonana: {formatDone(report.wykonano)}</p>}
        </article>
      )}
    </div>
  );
}
