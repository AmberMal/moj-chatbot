// Lekcja 8, Warsztat 1 (Standard): kolejność kart i podsumowanie priorytetów – bez zależności (też dla przeglądarki).
export const TRIAGE_PRIORITY_ORDER = ["wysoki", "średni", "niski"] as const;

type CardLike = { ok: boolean; numer: number; priorytet?: string };

// Od najwyższego priorytetu do najniższego; przy tym samym priorytecie – kolejność maili. Karty z błędem na końcu.
export function sortTriageCards<T extends CardLike>(cards: T[]): T[] {
  const rank = (card: T) => {
    if (!card.ok) return TRIAGE_PRIORITY_ORDER.length;
    const index = (TRIAGE_PRIORITY_ORDER as readonly string[]).indexOf(card.priorytet ?? "");
    return index === -1 ? TRIAGE_PRIORITY_ORDER.length - 1 : index;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.numer - b.numer);
}

export function triageSummary(cards: CardLike[]): { wysoki: number; średni: number; niski: number; bledy: number } {
  const summary = { wysoki: 0, średni: 0, niski: 0, bledy: 0 };
  for (const card of cards) {
    if (!card.ok) summary.bledy++;
    else if (card.priorytet === "wysoki" || card.priorytet === "średni" || card.priorytet === "niski") summary[card.priorytet]++;
  }
  return summary;
}
