// Lekcja 7, Warsztat 3: imię i avatar z danych konta Google (user_metadata) – bez zależności, łatwe do testowania.
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
// Tylko adres https (zdjęcie z Google) – inny adres nie trafi do znacznika img.
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
export function userFromMetadata(metadata: unknown): { name: string | null; avatarUrl: string | null } {
  const m = (typeof metadata === "object" && metadata !== null ? metadata : {}) as Record<string, unknown>;
  return { name: text(m.full_name, 80) ?? text(m.name, 80), avatarUrl: httpsUrl(m.avatar_url) ?? httpsUrl(m.picture) };
}

