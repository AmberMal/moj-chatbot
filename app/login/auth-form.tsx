"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase-auth/client";
import {
  AUTH_MESSAGES,
  AUTH_MIN_PASSWORD,
  authErrorMessage,
  isExistingAccountSignup,
  validateAuthInput,
  type AuthMode,
} from "../../lib/amber-auth-messages";

// Lekcja 7: dwie zakładki – „Zaloguj się” i „Załóż konto” (e-mail i hasło).
export default function AuthForm({ configured, next }: { configured: boolean; next: string }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pending, setPending] = useState(false);

  if (!configured) {
    return (
      <p className="error" role="alert">
        {AUTH_MESSAGES.notConfigured}
      </p>
    );
  }

  function switchMode(target: AuthMode) {
    setMode(target);
    setError("");
    setInfo("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setInfo("");
    const problem = validateAuthInput(email, password, mode);
    if (problem) {
      setError(problem);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError(AUTH_MESSAGES.notConfigured);
      return;
    }
    setPending(true);
    try {
      const credentials = { email: email.trim(), password };
      const { data, error: authError } =
        mode === "login"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp(credentials);
      if (authError) {
        setError(authErrorMessage(authError, mode));
        setPending(false);
        return;
      }
      if (mode === "signup" && isExistingAccountSignup(data.user)) {
        setError(AUTH_MESSAGES.accountExists);
        setPending(false);
        return;
      }
      if (!data.session) {
        // Gdyby w Supabase było włączone „Confirm email” – konto czeka na potwierdzenie.
        setInfo(AUTH_MESSAGES.checkEmail);
        setMode("login");
        setPending(false);
        return;
      }
      setPassword("");
      // Pełne przejście (bez starych danych w pamięci strony); strona logowania znika z historii „Wstecz”.
      window.location.replace(next);
      return;
      // (po udanym logowaniu przycisk zostaje zablokowany aż do przejścia na nową stronę)
    } catch {
      setError(AUTH_MESSAGES.network);
      setPending(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <form className="login" onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={isLogin}
          className={isLogin ? "auth-tab active" : "auth-tab"}
          disabled={pending}
          onClick={() => switchMode("login")}
        >
          Zaloguj się
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLogin}
          className={!isLogin ? "auth-tab active" : "auth-tab"}
          disabled={pending}
          onClick={() => switchMode("signup")}
        >
          Załóż konto
        </button>
      </div>
      <label htmlFor="email">E-mail</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        disabled={pending}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Hasło{isLogin ? "" : ` (min. ${AUTH_MIN_PASSWORD} znaków)`}</label>
      <input
        id="password"
        type="password"
        autoComplete={isLogin ? "current-password" : "new-password"}
        disabled={pending}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" className="auth-submit" disabled={pending}>
        {pending ? "Chwileczkę…" : isLogin ? "Zaloguj się" : "Załóż konto"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {info && <p className="auth-info">{info}</p>}
    </form>
  );
}
