"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { MissionReport, PublicMission } from "../../lib/amber-missions";
import { formatMissionDate, reportToText } from "../../lib/amber-mission-text";
import type { MissionRunSummary } from "../../lib/amber-mission-runs";

// Lekcja 8, Warsztaty 2–3: wybór misji (Raport, Porównanie trzech firm, Notatka z wizyty), formularz z pól misji i raport. Bez wysyłania;
// misje z „zapisuj” (Notatka z wizyty) mają pod formularzem 5 ostatnich zapisanych wykonań (W3 Dla szybkich).
function readReport(data: unknown): MissionReport | null {
  const raport = (data as { raport?: unknown } | null)?.raport as MissionReport | undefined;
  return raport && typeof raport.tytul === "string" && Array.isArray(raport.sekcje) ? raport : null;
}

export default function MissionsForm({ missions }: { missions: PublicMission[] }) {
  const [missionId, setMissionId] = useState(missions[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [report, setReport] = useState<MissionReport | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [runs, setRuns] = useState<MissionRunSummary[]>([]);
  const [runsError, setRunsError] = useState("");
  const [savedFrom, setSavedFrom] = useState<string | null>(null); // data otwartego zapisanego wyniku
  const [saveNote, setSaveNote] = useState("");
  const mission = missions.find((m) => m.id === missionId);
  const saved = mission?.zapisuj === true;

  // Dla szybkich: lista 5 ostatnich wykonań (tylko własne – RLS).
  const loadRuns = useCallback(async (id: string) => {
    setRunsError("");
    try {
      const response = await fetch(`/api/missions/runs?misja=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { wykonania?: MissionRunSummary[]; komunikat?: string } | null;
      if (!response.ok || !Array.isArray(data?.wykonania)) {
        setRuns([]);
        setRunsError(data?.komunikat ?? "Nie udało się pobrać zapisanych wykonań.");
        return;
      }
      setRuns(data.wykonania);
    } catch {
      setRuns([]);
      setRunsError("Brak połączenia z serwerem.");
    }
  }, []);

  useEffect(() => {
    if (saved) void loadRuns(missionId);
    else setRuns([]);
  }, [missionId, saved, loadRuns]);

  async function openRun(run: MissionRunSummary) {
    if (pending) return;
    setError("");
    setSaveNote("");
    setCopied(false);
    try {
      const response = await fetch(`/api/missions/runs/${run.id}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      const result = response.ok ? readReport(data) : null;
      if (!result) {
        setError((data as { komunikat?: string } | null)?.komunikat ?? "Nie udało się otworzyć zapisanego wyniku.");
        return;
      }
      setReport(result);
      setSavedFrom(run.utworzono);
    } catch {
      setError("Brak połączenia z serwerem.");
    }
  }

  function choose(id: string) {
    if (pending) return;
    setMissionId(id);
    setValues({});
    setReport(null);
    setError("");
    setSavedFrom(null);
    setSaveNote("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !mission) return;
    setPending(true);
    setError("");
    setReport(null);
    setCopied(false);
    setSavedFrom(null);
    setSaveNote("");
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
      else {
        setReport(result);
        const zapis = (data as { zapis?: { ok?: boolean; komunikat?: string } } | null)?.zapis;
        if (zapis && !zapis.ok) setSaveNote(zapis.komunikat ?? "Nie udało się zapisać wyniku.");
        if (saved) void loadRuns(mission.id);
      }
    } catch {
      setError("Brak połączenia z serwerem.");
    } finally {
      setPending(false);
    }
  }

  // Dla szybkich: cały wynik jako zwykły tekst do schowka.
  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Nie udało się skopiować – zaznacz wynik i skopiuj ręcznie (Cmd+C).");
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
            {/* 27.11 (wygląd, A + D): kafelki w rzędzie – ikona, nazwa, krótki opis; wybrany jest żółty */}
            <span className="mission-icon" aria-hidden="true">
              {m.ikona}
            </span>
            <strong>{m.nazwa}</strong>
            <span>{m.krotko}</span>
          </button>
        ))}
      </div>

      {mission && (
        // Nazwa i pełny opis wybranej misji; Standard (W3): kontrakt – cel, narzędzia, wynik, kontrola.
        <div className="mission-contract">
          <h2>{mission.nazwa}</h2>
          <p className="mission-desc">{mission.opis}</p>
          {mission.kontrakt && (
          <details>
            <summary>Jak działa ta misja</summary>
            <dl>
              <dt>Cel</dt>
              <dd>{mission.kontrakt.cel}</dd>
              <dt>Narzędzia</dt>
              <dd>{mission.kontrakt.narzedzia}</dd>
              <dt>Wynik</dt>
              <dd>{mission.kontrakt.wynik}</dd>
              <dt>Sprawdź przed użyciem</dt>
              <dd>{mission.kontrakt.kontrola}</dd>
            </dl>
          </details>
          )}
        </div>
      )}

      {mission && (
        <form className="triage-form" onSubmit={handleSubmit}>
          {mission.pola.map((field) => (
            <label key={field.name} className="mission-field">
              {field.label}
              {field.multiline ? (
                <textarea
                  rows={10}
                  value={values[field.name] ?? ""}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  disabled={pending}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                />
              ) : (
                <input
                  type="text"
                  value={values[field.name] ?? ""}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  disabled={pending}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                />
              )}
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

      {saved && (
        <section className="mission-runs" aria-label="Ostatnie wykonania">
          <h3>Ostatnie wykonania</h3>
          {runsError ? (
            <p className="hint">{runsError}</p>
          ) : runs.length === 0 ? (
            <p className="hint">Brak zapisanych wykonań – uruchom misję, a wynik pojawi się tutaj.</p>
          ) : (
            <ul>
              {runs.map((run) => (
                <li key={run.id}>
                  <button type="button" className="mission-run" onClick={() => openRun(run)} disabled={pending}>
                    <strong>{formatMissionDate(run.utworzono)}</strong>
                    {run.podglad && <span> · {run.podglad}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <article className="mission-report">
          {savedFrom && <p className="mission-saved">Zapisany wynik z {formatMissionDate(savedFrom)}</p>}
          {saveNote && <p className="mission-saved">{saveNote}</p>}
          <h2>{report.tytul}</h2>
          {report.opis && <p className="mission-audience">{report.opis}</p>}
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
          {report.wykonano && <p className="mission-time">Misja wykonana: {formatMissionDate(report.wykonano)}</p>}
          <button type="button" className="logout mission-copy" onClick={copyReport}>
            {copied ? "Skopiowano ✓" : "Kopiuj jako tekst"}
          </button>
        </article>
      )}
    </div>
  );
}
