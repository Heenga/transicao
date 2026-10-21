import type { Sport } from "../schema/plano.js";

export const SPORT_PT: Record<Sport, string> = {
  swim: "Natação",
  bike: "Bike",
  run: "Corrida",
  strength: "Força",
  brick: "Transição",
  race: "Prova",
  rest: "Descanso",
};

export function formatDuration(minutes: number | undefined): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  return `${m} min`;
}

export function getSportIcon(sport: Sport): string {
  const icons: Record<Sport, string> = {
    swim: "\u{1F3CA}",
    bike: "\u{1F6B4}",
    run: "\u{1F3C3}",
    strength: "\u{1F4AA}",
    brick: "\u{1F525}",
    race: "\u{1F3C6}",
    rest: "\u{1F6CC}",
  };
  return icons[sport] || "";
}
