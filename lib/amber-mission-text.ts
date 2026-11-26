// Lekcja 8, Warsztat 2 (Dla szybkich): wynik misji jako zwykły tekst – do przycisku „Kopiuj jako tekst”.
// Działa w przeglądarce i w testach (bez zależności).
import type { MissionReport } from "./amber-missions";

export function formatMissionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function reportToText(report: MissionReport, formatDate: (iso: string) => string = formatMissionDate): string {
  const lines: string[] = [report.tytul];
  if (report.opis) lines.push(report.opis);
  for (const s of report.sekcje) {
    lines.push("", s.tytul.toUpperCase());
    if (s.typ === "tekst") lines.push(s.tekst);
    if (s.typ === "lista") lines.push(...s.punkty.map((p) => `- ${p}`));
    if (s.typ === "tabela") {
      for (const w of s.wiersze) {
        lines.push(`${w.kryterium}:`);
        lines.push(...s.kolumny.map((k, i) => `  ${k} – ${w.wartosci[i] ?? ""}`));
      }
    }
    if (s.typ === "linki") {
      if (s.linki.length === 0) lines.push(s.brak ?? "");
      else lines.push(...s.linki.map((l, i) => (s.numerowane ? `[${i + 1}] ${l.tytul} – ${l.url}` : `- ${l.tytul} – ${l.url}`)));
    }
  }
  if (report.wykonano) {
    const when = formatDate(report.wykonano);
    if (when) lines.push("", `Misja wykonana: ${when}`);
  }
  return lines.join("\n");
}
