"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError("");
    try {
      // Hasło sprawdza wyłącznie serwer.
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setPassword("");
        router.refresh();
        return;
      }
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Nie udało się zalogować.");
    } catch {
      setError("Brak połączenia z serwerem.");
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <p className="error" role="alert">
        Dostęp zablokowany: brak konfiguracji CHAT_PASSWORD lub SESSION_SECRET w .env.local.
      </p>
    );
  }

  return (
    <form className="login" onSubmit={handleSubmit}>
      <label htmlFor="password">Wpisz hasło</label>
      <div className="composer">
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={!password || pending}>
          {pending ? "Sprawdzam…" : "Wejdź"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
