"use client";

import { useState, type FormEvent } from "react";
import {
  KEY_PREFERENCES,
  KEY_PREFERENCE_EMPTY,
  PROFILE_API,
  preferenceLabel,
  readProfileResponse,
  type ProfileView,
} from "@/lib/amber-chat-client";

const KEY_NAMES: readonly string[] = KEY_PREFERENCES.map((item) => item.key);

// 27.11 (wygląd, wariant 2): gotowe znaczniki do kliknięcia (podpowiedzi w przeglądarce, nie fakty o firmie).
const CHIPS: Record<string, readonly string[]> = {
  rodzaj_obiektu: ["dom", "mieszkanie", "biuro", "sklep"],
  system_alarmowy: ["Ajax", "Texecom", "Pyronix", "brak"],
};

// Lekcja 5, Warsztat 3 (Standard): edycja profilu na /profile.
// Wszystkie zmiany idą przez /api/profile (serwer sprawdza sesję i te same zasady co narzędzie zapiszProfil:
// bez haseł, kluczy, numerów kart i kont, dokumentów, danych o zdrowiu).
// 27.11 (wygląd A + E): wizytówka na górze, pod nią edycja, a obok podgląd „Tak Amber Cię widzi” (powitanie z serwera).
export default function ProfileEditor({ initial, initialGreeting }: { initial: ProfileView; initialGreeting: string }) {
  const [profile, setProfile] = useState<ProfileView>(initial);
  const [name, setName] = useState(initial.name ?? "");
  const [values, setValues] = useState<Record<string, string>>(initial.preferences);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [greeting, setGreeting] = useState(initialGreeting);
  // 27.11 (wygląd): znaczniki zawsze widoczne w kartach; editing = przy której pozycji otwarte jest pole „+ inne”.
  const [editing, setEditing] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);

  async function send(method: "PATCH" | "DELETE", body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(PROFILE_API, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const text = (data as { komunikat?: unknown } | null)?.komunikat;
        setMessage({ kind: "error", text: typeof text === "string" ? text : "Nie udało się zapisać zmian. Spróbuj ponownie." });
        return false;
      }
      const parsed = readProfileResponse(data);
      if (parsed) {
        setProfile(parsed.profile);
        setName(parsed.profile.name ?? "");
        setValues(parsed.profile.preferences);
        setGreeting(parsed.greeting);
      }
      setMessage({ kind: "ok", text: success });
      return true;
    } catch {
      setMessage({ kind: "error", text: "Brak połączenia z serwerem. Spróbuj ponownie." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) void send("PATCH", { imie: name }, "Zapisano imię.");
  }
  // Klik w znacznik: zapis od razu; klik w już wybrany – usunięcie pozycji.
  async function pickChip(key: string, label: string, value: string) {
    if (profile.preferences[key] === value) {
      await send("DELETE", { pozycja: key }, `Usunięto: ${label}.`);
      return;
    }
    setValues((all) => ({ ...all, [key]: value }));
    if (await send("PATCH", { preferencje: { [key]: value } }, `Zapisano: ${label}.`)) {
      setEditing(null);
      setOtherOpen(false);
    }
  }
  async function savePreference(key: string) {
    if (await send("PATCH", { preferencje: { [key]: values[key] ?? "" } }, `Zapisano: ${preferenceLabel(key)}.`)) {
      setEditing(null);
      setOtherOpen(false);
    }
  }
  async function addPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    if (await send("PATCH", { preferencje: { [newKey]: newValue } }, "Dodano nową pozycję.")) {
      setNewKey("");
      setNewValue("");
    }
  }
  function clearAll() {
    if (window.confirm("Wyczyścić cały profil (imię i wszystkie preferencje)? Tej operacji nie można cofnąć.")) {
      void send("DELETE", { wszystko: true }, "Profil wyczyszczony.");
    }
  }

  const keys = Object.keys(profile.preferences).filter((key) => !KEY_NAMES.includes(key));
  const known = Object.entries(profile.preferences).filter(([, value]) => value.trim());
  const initialLetter = (profile.name ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="profile-layout">
      {/* Komunikat nad obiema kolumnami – wizytówka i podgląd zaczynają się na tej samej wysokości */}
      {message && (
        <p className={`profile-message ${message.kind === "ok" ? "profile-ok" : "error"}`} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    <div className="profile-editor">

      {/* Wizytówka klienta (wariant A) */}
      <section className="profile-card profile-hero">
        <div className="profile-hero-top">
          <span className="profile-avatar" aria-hidden="true">
            {initialLetter}
          </span>
          <div>
            <p className="profile-hero-name">{profile.name ?? "Bez imienia"}</p>
            <p className="profile-note">tak zwraca się do Ciebie Amber</p>
          </div>
        </div>
        <h2 className="sr-only">Imię</h2>
        <form className="profile-row" onSubmit={saveName}>
          <input type="text" aria-label="Imię" value={name} maxLength={60} placeholder="Brak imienia w profilu" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="logout" disabled={busy || !name.trim() || name.trim() === profile.name}>
            Zapisz
          </button>
          <button type="button" className="history-delete" disabled={busy || !profile.name} onClick={() => void send("DELETE", { imie: true }, "Usunięto imię.")}>
            Usuń
          </button>
        </form>
      </section>

      {/* Dla szybkich: trzy pozycje ważne dla Amber Security – zawsze widoczne, także puste */}
      <section className="profile-card">
        <h2>Najważniejsze dla Amber</h2>
        <p className="profile-note">Amber dopyta o brakujące pozycje, gdy rozmowa będzie ich dotyczyć, i będzie z nich korzystać w odpowiedziach.</p>
        <div className="pref-cards">
        {KEY_PREFERENCES.map((item) => {
          const saved = profile.preferences[item.key];
          const current = values[item.key] ?? "";
          const options: readonly string[] = "options" in item ? item.options : CHIPS[item.key] ?? [];
          const custom = saved && !options.includes(saved) ? saved : null;
          return (
            <div key={item.key} className="pref-group pref-card pref-open" role="group" aria-label={item.label}>
              <span className="pref-cap">{item.label}</span>
              <div className="chip-row">
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`chip${saved === option ? " chip-on" : ""}`}
                    aria-pressed={saved === option}
                    disabled={busy}
                    onClick={() => void pickChip(item.key, item.label, option)}
                  >
                    {option}
                  </button>
                ))}
                {custom && (
                  <button type="button" className="chip chip-on" aria-pressed="true" disabled={busy} onClick={() => void pickChip(item.key, item.label, custom)}>
                    {custom}
                  </button>
                )}
                {!("options" in item) && !(otherOpen && editing === item.key) && (
                  <button type="button" className="chip chip-add" disabled={busy} onClick={() => {
                      setEditing(item.key);
                      setOtherOpen(true);
                    }}>
                    + inne
                  </button>
                )}
              </div>
              <span className="pref-hint">{saved ? "Kliknij wybrany znacznik, żeby usunąć." : KEY_PREFERENCE_EMPTY}</span>
              {otherOpen && editing === item.key && !("options" in item) && (
                <div className="chip-other">
                  <input
                    id={`pref-${item.key}`}
                    type="text"
                    aria-label={`${item.label} – inne`}
                    value={custom ? current : options.includes(current) ? "" : current}
                    maxLength={200}
                    autoFocus
                    placeholder={item.hint}
                    onChange={(e) => setValues((all) => ({ ...all, [item.key]: e.target.value }))}
                  />
                  <button type="button" className="logout pref-save" disabled={busy || !current.trim() || current === saved} onClick={() => void savePreference(item.key)}>
                    Zapisz
                  </button>
                  <button
                    type="button"
                    className="logout"
                    disabled={busy}
                    onClick={() => {
                      setValues((all) => ({ ...all, [item.key]: saved ?? "" }));
                      setOtherOpen(false);
                    }}
                  >
                    Anuluj
                  </button>
                </div>
              )}

            </div>
          );
        })}
        </div>
      </section>

      <section className="profile-card">
        <h2>Inne preferencje</h2>
        {keys.length === 0 && <p className="hint">Brak innych zapisanych preferencji.</p>}
        {keys.map((key) => (
          <div key={key} className="profile-row">
            <label className="profile-label" htmlFor={`pref-${key}`}>
              {preferenceLabel(key)}
            </label>
            <input
              id={`pref-${key}`}
              type="text"
              value={values[key] ?? ""}
              maxLength={200}
              onChange={(e) => setValues((current) => ({ ...current, [key]: e.target.value }))}
            />
            <button type="button" className="logout" disabled={busy || !(values[key] ?? "").trim() || values[key] === profile.preferences[key]} onClick={() => savePreference(key)}>
              Zapisz
            </button>
            <button type="button" className="history-delete" disabled={busy} onClick={() => void send("DELETE", { pozycja: key }, `Usunięto: ${preferenceLabel(key)}.`)}>
              Usuń
            </button>
          </div>
        ))}
        <form className="profile-row profile-add" onSubmit={addPreference}>
          <input type="text" aria-label="Nazwa nowej pozycji" placeholder="nazwa, np. miasto" value={newKey} maxLength={30} onChange={(e) => setNewKey(e.target.value)} />
          <input type="text" aria-label="Wartość nowej pozycji" placeholder="wartość, np. Toruń" value={newValue} maxLength={200} onChange={(e) => setNewValue(e.target.value)} />
          <button type="submit" className="logout" disabled={busy || !newKey.trim() || !newValue.trim()}>
            Dodaj
          </button>
        </form>
      </section>


    </div>

      {/* Podgląd (wariant E): co Amber wie i jak przywita w nowej rozmowie */}
      <aside className="profile-preview" aria-label="Tak Amber Cię widzi">
        <h2>Tak Amber Cię widzi</h2>
        <p className="profile-greeting">„{greeting}”</p>
        <p className="profile-note">Amber pamięta:</p>
        {known.length === 0 ? (
          <p className="profile-note">jeszcze nic – uzupełnij profil albo powiedz to Amber w rozmowie.</p>
        ) : (
          <ul className="profile-known">
            {known.map(([key, value]) => (
              <li key={key}>
                <span>{preferenceLabel(key)}:</span> {value}
              </li>
            ))}
          </ul>
        )}
      </aside>
      {/* „Wyczyść profil” pod kolumnami – podgląd kończy się na dole „Innych preferencji” */}
      <div className="profile-clear profile-clear-row">
        <button type="button" className="history-delete" disabled={busy || (!profile.name && Object.keys(profile.preferences).length === 0)} onClick={clearAll}>
          Wyczyść profil
        </button>
      </div>
    </div>
  );
}
