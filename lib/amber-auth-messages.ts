// Lekcja 7: komunikaty logowania i rejestracji po polsku (bez zależności – łatwe do testowania).
export const AUTH_MIN_PASSWORD = 8;

export const AUTH_MESSAGES = {
  notConfigured:
    "Logowanie nie jest skonfigurowane: brak NEXT_PUBLIC_SUPABASE_URL lub NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY w .env.local.",
  emptyEmail: "Wpisz adres e-mail.",
  badEmail: "Niepoprawny adres e-mail.",
  emptyPassword: "Wpisz hasło.",
  shortPassword: `Hasło jest za krótkie – musi mieć co najmniej ${AUTH_MIN_PASSWORD} znaków.`,
  wrongPassword: "Nieprawidłowy e-mail lub hasło.",
  accountExists: "Konto z tym adresem e-mail już istnieje. Zaloguj się w zakładce „Zaloguj się”.",
  tooMany: "Za dużo prób. Spróbuj ponownie za kilka minut.",
  notConfirmed: "Konto nie jest jeszcze potwierdzone. Sprawdź skrzynkę e-mail.",
  checkEmail: "Konto założone. Potwierdź adres e-mail linkiem z wiadomości, a potem zaloguj się.",
  signupDisabled: "Zakładanie nowych kont jest wyłączone.",
  network: "Brak połączenia z serwerem logowania. Spróbuj ponownie.",
  loginFailed: "Nie udało się zalogować. Spróbuj ponownie.",
  signupFailed: "Nie udało się założyć konta. Spróbuj ponownie.",
  googleFailed: "Nie udało się zalogować przez Google. Spróbuj ponownie albo zaloguj się e-mailem.",
  googleCancelled: "Logowanie przez Google zostało anulowane.",
} as const;

export type AuthMode = "login" | "signup";

// Sprawdzenie w przeglądarce przed wysłaniem (Supabase i tak sprawdza po swojej stronie).
export function validateAuthInput(email: string, password: string, mode: AuthMode): string | null {
  const trimmed = email.trim();
  if (!trimmed) return AUTH_MESSAGES.emptyEmail;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return AUTH_MESSAGES.badEmail;
  if (!password) return AUTH_MESSAGES.emptyPassword;
  if (mode === "signup" && password.length < AUTH_MIN_PASSWORD) return AUTH_MESSAGES.shortPassword;
  return null;
}

// Supabase przy rejestracji na istniejący adres nie zwraca błędu (ochrona przed sprawdzaniem adresów),
// tylko użytkownika bez tożsamości (identities = []) i bez sesji. To znaczy: konto już istnieje.
export function isExistingAccountSignup(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}

// Błąd z Supabase Auth (pole code) → komunikat po polsku.
export function authErrorMessage(error: { code?: string; message?: string } | null | undefined, mode: AuthMode): string {
  switch (error?.code) {
    case "invalid_credentials":
      return AUTH_MESSAGES.wrongPassword;
    case "user_already_exists":
    case "email_exists":
    case "identity_already_exists":
      return AUTH_MESSAGES.accountExists;
    case "weak_password":
      return AUTH_MESSAGES.shortPassword;
    case "email_address_invalid":
      return AUTH_MESSAGES.badEmail;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return AUTH_MESSAGES.tooMany;
    case "email_not_confirmed":
      return AUTH_MESSAGES.notConfirmed;
    case "signup_disabled":
      return AUTH_MESSAGES.signupDisabled;
    default:
      return mode === "login" ? AUTH_MESSAGES.loginFailed : AUTH_MESSAGES.signupFailed;
  }
}
