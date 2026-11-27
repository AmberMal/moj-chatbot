"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { MissionField, MissionReport, PublicMission } from "../../lib/amber-missions";
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
  // 27.11: kroki formularza (grupa pól = jeden krok) i to, czego jeszcze brakuje do uruchomienia misji.
  const steps = (mission?.pola ?? []).filter((f, i, all) => !f.group || all.findIndex((g) => g.group?.id === f.group?.id) === i);
  const missing = mission ? missingText(mission.pola, values) : null;
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
          {mission.pola.map((field, index) => {
            const step = steps.length > 1 ? steps.indexOf(field) + 1 : 0;
            // Pola z jedną grupą (np. Firma 1–3) – jeden zestaw znaczników przy pierwszym polu grupy.
            if (field.group) {
              const members = mission.pola.filter((f) => f.group?.id === field.group?.id);
              if (members[0] !== field) return null;
              return (
                <GroupChips
                  step={step}
                  key={`${mission.id}-${field.group.id}-${index}`}
                  label={field.group.label}
                  fields={members}
                  values={members.map((f) => values[f.name] ?? "")}
                  disabled={pending}
                  onChange={(picked) =>
                    setValues((v) => ({ ...v, ...Object.fromEntries(members.map((f, i) => [f.name, picked[i] ?? ""])) }))
                  }
                />
              );
            }
            return (
              <MissionInput
                step={step}
                key={`${mission.id}-${field.name}`}
                field={field}
                value={values[field.name] ?? ""}
                disabled={pending}
                onChange={(value) => setValues((v) => ({ ...v, [field.name]: value }))}
              />
            );
          })}
          {/* 27.11: przycisk mówi, czego jeszcze brakuje; aktywny dopiero, gdy wszystko jest wybrane */}
          <button type="submit" className="auth-submit mission-run-btn" disabled={pending || missing !== null}>
            {pending ? "Agent pracuje…" : missing ?? "Uruchom misję"}
          </button>
        </form>
      )}

      {saved && (
        <section className="mission-runs" aria-label="Ostatnie wykonania">
          <h3>Ostatnie wykonania</h3>
          <p className="mission-saved-note">Wyniki tej misji są zapisywane na Twoim koncie (widzisz je tylko Ty). Agent niczego nie wysyła.</p>
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

// 27.11 (wygląd): jedno pole formularza misji – zwykłe pole, lista do wyboru (+ „inna…”) albo znaczniki do zaznaczenia.
function MissionInput({ step, field, value, disabled, onChange }: { step: number; field: MissionField; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [other, setOther] = useState(false);
  const [extra, setExtra] = useState("");

  if (field.multi) {
    const multi = field.multi;
    const picked = value.split(",").map((v) => v.trim()).filter(Boolean);
    const all = [...multi.choices, ...picked.filter((p) => !multi.choices.includes(p))];
    const toggle = (item: string) => {
      const next = picked.includes(item) ? picked.filter((p) => p !== item) : picked.length < multi.max ? [...picked, item] : picked;
      onChange(next.join(", "));
    };
    const addExtra = () => {
      const item = extra.trim().replace(/,/g, " ");
      if (item && !picked.includes(item) && picked.length < multi.max) onChange([...picked, item].join(", "));
      setExtra("");
      setOther(false);
    };
    return (
      <div className="mission-field" role="group" aria-label={field.label}>
        <StepTitle step={step} label={field.label} count={`${picked.length}/${multi.max}`} />
        <div className="chip-row">
          {all.map((item) => (
            <button
              key={item}
              type="button"
              className={`chip${picked.includes(item) ? " chip-on" : ""}`}
              aria-pressed={picked.includes(item)}
              disabled={disabled || (!picked.includes(item) && picked.length >= multi.max)}
              onClick={() => toggle(item)}
            >
              {item}
            </button>
          ))}
          {!other && (
            <button type="button" className="chip chip-add" disabled={disabled || picked.length >= multi.max} onClick={() => setOther(true)}>
              + inne
            </button>
          )}
        </div>
        {other && (
          <div className="chip-other">
            <input
              type="text"
              aria-label={`${field.label} – inne`}
              value={extra}
              maxLength={60}
              autoFocus
              disabled={disabled}
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExtra();
                }
              }}
            />
            <button type="button" className="logout pref-save" disabled={disabled || !extra.trim()} onClick={addExtra}>
              Dodaj
            </button>
            <button type="button" className="logout" onClick={() => { setOther(false); setExtra(""); }}>
              Anuluj
            </button>
          </div>
        )}
        <small className="mission-hint">Zaznacz od {multi.min} do {multi.max}.</small>
      </div>
    );
  }

  if (field.choices) {
    // 27.11 (wygląd): jeden wybór znacznikiem (np. „Dla kogo wybieramy”) + „+ inne” z polem do wpisania.
    const choices = field.choices;
    const custom = value && !choices.includes(value) ? value : null;
    const pick = (item: string) => onChange(value === item ? "" : item);
    return (
      <div className="mission-field" role="group" aria-label={field.label}>
        <StepTitle step={step} label={field.label} count={value ? "1/1" : "0/1"} />
        <div className="chip-row">
          {[...choices, ...(custom ? [custom] : [])].map((item) => (
            <button key={item} type="button" className={`chip${value === item ? " chip-on" : ""}`} aria-pressed={value === item} disabled={disabled} onClick={() => pick(item)}>
              {item}
            </button>
          ))}
          {!other && (
            <button type="button" className="chip chip-add" disabled={disabled} onClick={() => setOther(true)}>
              + inne
            </button>
          )}
        </div>
        {other && (
          <div className="chip-other">
            <input
              type="text"
              aria-label={`${field.label} – inne`}
              value={extra}
              maxLength={field.maxLength}
              placeholder={field.placeholder}
              autoFocus
              disabled={disabled}
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (extra.trim()) onChange(extra.trim());
                  setExtra("");
                  setOther(false);
                }
              }}
            />
            <button
              type="button"
              className="logout pref-save"
              disabled={disabled || !extra.trim()}
              onClick={() => {
                onChange(extra.trim());
                setExtra("");
                setOther(false);
              }}
            >
              Dodaj
            </button>
            <button type="button" className="logout" onClick={() => { setOther(false); setExtra(""); }}>
              Anuluj
            </button>
          </div>
        )}
        <small className="mission-hint">Wybierz jedną pozycję albo dopisz własną.</small>
      </div>
    );
  }

  return (
    <label className="mission-field">
      {step ? <StepTitle step={step} label={field.label} /> : field.label}
      {field.multiline ? (
        <textarea rows={10} value={value} maxLength={field.maxLength} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} maxLength={field.maxLength} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
      <small>
        {field.hint ? `${field.hint} ` : ""}
        {value.length}/{field.maxLength}
      </small>
    </label>
  );
}

// 27.11 (wygląd): grupa pól jako znaczniki – np. „Firmy do porównania”: zaznacz dokładnie tyle, ile jest pól (3).
function GroupChips({ step, label, fields, values, disabled, onChange }: { step: number; label: string; fields: MissionField[]; values: string[]; disabled: boolean; onChange: (picked: string[]) => void }) {
  const [other, setOther] = useState(false);
  const [extra, setExtra] = useState("");
  const max = fields.length;
  const choices = fields[0].choices ?? [];
  const picked = values.filter(Boolean);
  const all = [...choices, ...picked.filter((p) => !choices.includes(p))];
  const toggle = (item: string) => {
    const next = picked.includes(item) ? picked.filter((p) => p !== item) : picked.length < max ? [...picked, item] : picked;
    onChange(next);
  };
  const addExtra = () => {
    const item = extra.trim();
    if (item && !picked.some((p) => p.toLowerCase() === item.toLowerCase()) && picked.length < max) onChange([...picked, item.slice(0, fields[0].maxLength)]);
    setExtra("");
    setOther(false);
  };
  return (
    <div className="mission-field" role="group" aria-label={label}>
      <StepTitle step={step} label={label} count={`${picked.length}/${max}`} />
      <div className="chip-row">
        {all.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip${picked.includes(item) ? " chip-on" : ""}`}
            aria-pressed={picked.includes(item)}
            disabled={disabled || (!picked.includes(item) && picked.length >= max)}
            onClick={() => toggle(item)}
          >
            {picked.includes(item) ? `${picked.indexOf(item) + 1}. ${item}` : item}
          </button>
        ))}
        {!other && (
          <button type="button" className="chip chip-add" disabled={disabled || picked.length >= max} onClick={() => setOther(true)}>
            + inna
          </button>
        )}
      </div>
      {other && (
        <div className="chip-other">
          <input
            type="text"
            aria-label={`${label} – inna`}
            value={extra}
            maxLength={fields[0].maxLength}
            autoFocus
            disabled={disabled}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExtra();
              }
            }}
          />
          <button type="button" className="logout pref-save" disabled={disabled || !extra.trim()} onClick={addExtra}>
            Dodaj
          </button>
          <button type="button" className="logout" onClick={() => { setOther(false); setExtra(""); }}>
            Anuluj
          </button>
        </div>
      )}
      <small className="mission-hint">Zaznacz {max}. Kolejność zaznaczania = kolejność w tabeli.</small>
    </div>
  );
}

// 27.11: nagłówek kroku – numer w żółtym kółku, nazwa i licznik zaraz obok.
function StepTitle({ step, label, count }: { step: number; label: string; count?: string }) {
  return (
    <span className="step-title">
      {step > 0 && <span className="step-num" aria-hidden="true">{step}</span>}
      <span className="step-label">{label}</span>
      {count && <span className="step-count">{count}</span>}
    </span>
  );
}

// 27.11: co jeszcze trzeba uzupełnić (null = wszystko gotowe). Te same progi co na serwerze.
function missingText(fields: MissionField[], values: Record<string, string>): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (f.group) {
      if (seen.has(f.group.id)) continue;
      seen.add(f.group.id);
      const members = fields.filter((g) => g.group?.id === f.group?.id);
      const have = members.filter((g) => (values[g.name] ?? "").trim()).length;
      if (have < members.length) return `Wybierz jeszcze ${members.length - have}: ${f.group.label.toLowerCase()}`;
      continue;
    }
    const v = (values[f.name] ?? "").trim();
    if (f.multi) {
      const n = v ? v.split(",").map((x) => x.trim()).filter(Boolean).length : 0;
      if (n < f.multi.min) return `Zaznacz jeszcze ${f.multi.min - n}: ${f.label.toLowerCase()}`;
      continue;
    }
    if (!v) return f.choices ? `Wybierz: ${f.label.toLowerCase()}` : `Uzupełnij: ${f.label.toLowerCase()}`;
    if (f.minLength && v.length < f.minLength) return `Dopisz więcej: ${f.label.toLowerCase()}`;
  }
  return null;
}
