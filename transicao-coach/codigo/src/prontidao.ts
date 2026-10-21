/**
 * Prontidão diária (readiness) — regras de conhecimento/07-grupo-e-prontidao.md.
 * Entradas vêm do Garmin/Apple Watch (HRV, FC de repouso, sono) + check-in do app + TSB.
 */

export type ReadinessStatus = "verde" | "amarelo" | "vermelho" | "doenca";

export interface ReadinessInput {
  /** HRV dos últimos 7 dias (ms), mais antigo primeiro. */
  hrvLast7?: number[];
  /** Linha de base de HRV (média 28–60 dias). */
  hrvBaseline?: number;
  /** FC de repouso dos últimos 3 dias. */
  rhrLast3?: number[];
  rhrBaseline?: number;
  /** Horas de sono das últimas noites, mais recente por último. */
  sleepHoursLast?: number[];
  /** Score de sono do Garmin (0–100), mais recente por último. */
  sleepScoreLast?: number[];
  sleepGoalHours?: number;
  tsb?: number;
  /** Check-in subjetivo, 1–5, dos últimos dias (mais recente por último). */
  checkins?: { sono: number; energia: number; dor: number; humor: number }[];
  /** Atleta relatou febre, dor aguda etc. */
  reportedIllness?: boolean;
}

export interface Readiness {
  status: ReadinessStatus;
  alerts: string[];
}

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function readiness(r: ReadinessInput): Readiness {
  const alerts: string[] = [];

  if (r.reportedIllness) return { status: "doenca", alerts: ["Atleta relatou sintoma de doença ou dor aguda"] };

  // FCR caindo bruscamente também pode indicar início de doença
  if (r.rhrLast3?.length && r.rhrBaseline && r.rhrLast3[r.rhrLast3.length - 1] <= r.rhrBaseline - 8) {
    alerts.push(`FC de repouso ${r.rhrLast3.at(-1)} bpm, bem abaixo da base (${r.rhrBaseline}): possível início de doença`);
  }

  if (r.hrvLast7?.length && r.hrvBaseline) {
    const h = avg(r.hrvLast7);
    const drop = (r.hrvBaseline - h) / r.hrvBaseline;
    if (drop >= 0.1) alerts.push(`HRV 7d ${Math.round(h)} ms, ${Math.round(drop * 100)}% abaixo da base`);
  }

  if (r.rhrLast3 && r.rhrLast3.length >= 3 && r.rhrBaseline && r.rhrLast3.every((x) => x >= r.rhrBaseline! + 5)) {
    alerts.push(`FC de repouso ≥ ${r.rhrBaseline + 5} bpm há 3 dias`);
  }

  const sleepBad = (() => {
    const last2h = r.sleepHoursLast?.slice(-2) ?? [];
    const last2s = r.sleepScoreLast?.slice(-2) ?? [];
    const short = last2h.length === 2 && last2h.every((h) => h < Math.min(6, (r.sleepGoalHours ?? 7) - 1));
    const lowScore = last2s.length === 2 && last2s.every((s) => s < 60);
    return short || lowScore;
  })();
  if (sleepBad) alerts.push("Sono curto ou de baixa qualidade nas últimas 2 noites");

  if (r.tsb != null && r.tsb < -30) alerts.push(`TSB ${r.tsb} (overreaching)`);

  let subjectiveBad = false;
  let sleepAndMoodLow = false;
  const last3 = r.checkins?.slice(-3) ?? [];
  if (last3.length === 3) {
    subjectiveBad = last3.every((c) => [c.sono, c.energia, 6 - c.dor, c.humor].filter((v) => v <= 2).length >= 2);
    if (subjectiveBad) alerts.push("Check-in com 2+ notas baixas há 3 dias");
  }
  const lastC = r.checkins?.at(-1);
  if (lastC && lastC.sono <= 2 && lastC.humor <= 2) {
    sleepAndMoodLow = true;
    alerts.push("Sono e humor baixos juntos (risco de esgotamento)");
  }

  const hardRed = (r.tsb != null && r.tsb < -30) || sleepAndMoodLow;
  const status: ReadinessStatus = hardRed || alerts.length >= 2 ? "vermelho" : alerts.length === 1 ? "amarelo" : "verde";
  return { status, alerts };
}
