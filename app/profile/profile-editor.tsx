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

// Lekcja 5, Warsztat 3 (Standard): edycja profilu na /profile.
// Wszystkie zmiany idą przez /api/profile (serwer sprawdza sesję i te same zasady co narzędzie zapiszProfil:
// bez haseł, kluczy, numerów kart i kont, dokumentów, danych o zdrowiu).
export default function ProfileEditor({ initial }: { initial: ProfileView }) {
  const [profile, setProfile] = useState<ProfileView>(initial);
  const [name, setName] = useState(initial.name ?? "");
  const [values, setValues] = useState<Record<string, string>>(initial.preferences);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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
  function savePreference(key: string) {
    void send("PATCH", { preferencje: { [key]: values[key] ?? "" } }, `Zapisano: ${preferenceLabel(key)}.`);
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
  return (
    <div className="profile-editor">
      {message && (
        <p className={message.kind === "ok" ? "profile-ok" : "error"} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}

      <section className="profile-card">
        <h2>Imię</h2>
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
        {KEY_PREFERENCES.map((item) => {
          const saved = profile.preferences[item.key];
          const current = values[item.key] ?? "";
          return (
            <div key={item.key} className="profile-row">
              <label className="profile-label" htmlFor={`pref-${item.key}`}>
                {item.label}
              </label>
              {"options" in item ? (
                <select
                  id={`pref-${item.key}`}
                  value={current}
                  onChange={(e) => setValues((all) => ({ ...all, [item.key]: e.target.value }))}
                >
                  <option value="">{KEY_PREFERENCE_EMPTY}</option>
                  {item.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`pref-${item.key}`}
                  type="text"
                  value={current}
                  maxLength={200}
                  placeholder={`${KEY_PREFERENCE_EMPTY} (${item.hint})`}
                  onChange={(e) => setValues((all) => ({ ...all, [item.key]: e.target.value }))}
                />
              )}
              <button type="button" className="logout" disabled={busy || !current.trim() || current === saved} onClick={() => savePreference(item.key)}>
                Zapisz
              </button>
              <button type="button" className="history-delete" disabled={busy || !saved} onClick={() => void send("DELETE", { pozycja: item.key }, `Usunięto: ${item.label}.`)}>
                Usuń
              </button>
            </div>
          );
        })}
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

      <div className="profile-clear">
        <button type="button" className="history-delete" disabled={busy || (!profile.name && Object.keys(profile.preferences).length === 0)} onClick={clearAll}>
          Wyczyść profil
        </button>
      </div>
    </div>
  );
}
