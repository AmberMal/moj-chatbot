// Lekcja 7: adres projektu i klucz publishable Supabase (Auth).
// Klucz publishable może trafić do przeglądarki – sam niczego nie otwiera (dane chronią reguły w bazie).
// Odwołania wprost do process.env.NEXT_PUBLIC_… – tylko tak Next.js wstawia wartości do kodu przeglądarki.
export function getSupabaseAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}
