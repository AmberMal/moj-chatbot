"use client";

import { useRouter } from "next/navigation";
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
export default function AuthForm({ configured }: { configured: boolean }) {
  const router = useRouter();
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

  function switchMode(next: AuthMode) {
    setMode(next);
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
        return;
      }
      if (mode === "signup" && isExistingAccountSignup(data.user)) {
        setError(AUTH_MESSAGES.accountExists);
        return;
      }
      if (!data.session) {
        // Gdyby w Supabase było włączone „Confirm email” – konto czeka na potwierdzenie.
        setInfo(AUTH_MESSAGES.checkEmail);
        setMode("login");
        return;
      }
      setPassword("");
      router.replace("/");
      router.refresh();
    } catch {
      setError(AUTH_MESSAGES.network);
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <form className="login" onSubmit={handleSubmit} noValidate>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={isLogin}
          className={isLogin ? "auth-tab active" : "auth-tab"}
          onClick={() => switchMode("login")}
        >
          Zaloguj się
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLogin}
          className={!isLogin ? "auth-tab active" : "auth-tab"}
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
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Hasło{isLogin ? "" : ` (min. ${AUTH_MIN_PASSWORD} znaków)`}</label>
      <input
        id="password"
        type="password"
        autoComplete={isLogin ? "current-password" : "new-password"}
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
