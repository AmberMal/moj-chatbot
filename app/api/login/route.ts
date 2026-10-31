import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  getAuthConfig,
  isPasswordCorrect,
  sessionCookieOptions,
} from "../../../lib/auth";
import {
  checkLoginAllowed,
  getClientKey,
  recordLoginFailure,
  resetLoginFailures,
} from "../../../lib/rate-limit";

export async function POST(req: Request) {
  const config = getAuthConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Logowanie zablokowane: brak CHAT_PASSWORD lub SESSION_SECRET (min. 32 znaki) w .env.local.",
      },
      { status: 503 },
    );
  }

  const clientKey = getClientKey(req);
  const limit = checkLoginAllowed(clientKey);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return NextResponse.json(
      { error: `Za dużo błędnych prób. Spróbuj ponownie za ${minutes} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // niepoprawne dane = traktujemy jak błędne hasło
  }

  if (!password || !isPasswordCorrect(password, config)) {
    recordLoginFailure(clientKey);
    await new Promise((resolve) => setTimeout(resolve, 500)); // spowalnia zgadywanie
    return NextResponse.json({ error: "Nieprawidłowe hasło." }, { status: 401 });
  }

  resetLoginFailures(clientKey);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(config), sessionCookieOptions());
  return response;
}
