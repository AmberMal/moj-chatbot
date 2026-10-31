// Ograniczenie prób zgadywania hasła.
//
// UWAGA: liczniki są trzymane w pamięci tego jednego procesu serwera.
// Lokalnie to wystarcza, ale NIE jest to globalna ochrona na hostingu:
// licznik znika po restarcie, a przy kilku instancjach (np. serverless)
// każda ma własny. Na produkcji potrzebny jest wspólny magazyn
// (np. Redis) albo limit po stronie hostingu (WAF / rate limiting).

const WINDOW_MS = 15 * 60 * 1000; // 15 minut
const MAX_FAILURES_PER_CLIENT = 5; // błędne próby z jednego adresu
const MAX_FAILURES_TOTAL = 50; // błędne próby łącznie (gdyby ktoś zmieniał adres)

type Entry = { count: number; resetAt: number };

const failures = new Map<string, Entry>();
let total: Entry = { count: 0, resetAt: 0 };

function fresh(entry: Entry | undefined, now: number): Entry {
  return entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
}

export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

export function checkLoginAllowed(clientKey: string, now = Date.now()) {
  const client = fresh(failures.get(clientKey), now);
  total = fresh(total, now);
  const blockedUntil =
    client.count >= MAX_FAILURES_PER_CLIENT
      ? client.resetAt
      : total.count >= MAX_FAILURES_TOTAL
        ? total.resetAt
        : 0;
  return blockedUntil
    ? { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) }
    : { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(clientKey: string, now = Date.now()): void {
  const client = fresh(failures.get(clientKey), now);
  client.count += 1;
  failures.set(clientKey, client);
  total = fresh(total, now);
  total.count += 1;

  // Sprzątanie starych wpisów, żeby mapa nie rosła bez końca.
  if (failures.size > 1000) {
    for (const [key, entry] of failures) {
      if (entry.resetAt <= now) failures.delete(key);
    }
  }
}

export function resetLoginFailures(clientKey: string): void {
  failures.delete(clientKey);
}
