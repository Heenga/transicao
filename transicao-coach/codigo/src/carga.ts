/**
 * Motor de carga do Transição.
 *
 * Calcula em código o que o claude-coach só descrevia em texto
 * (conhecimento/03-carga-de-treino.md e 04-periodizacao.md):
 *  - TSS por atividade realizada (Strava/Garmin) e por treino planejado
 *  - Série diária de CTL / ATL / TSB
 *  - Metas de TSS semanal até a prova (fases, 3:1 ou 2:1, polimento)
 *
 * A IA recebe as metas prontas e só escolhe os treinos que cabem nelas.
 */
import type { Sport, Workout, WorkoutStep, IntervalSet } from "./schema/plano.js";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Level = "beginner" | "intermediate" | "advanced";
export type EventType = "super_sprint" | "sprint" | "olimpico" | "70.3" | "ironman";

export interface Thresholds {
  ftp?: number; // W
  runLthr?: number; // bpm
  bikeLthr?: number; // bpm
  runThresholdSecKm?: number; // s/km
  cssSec100m?: number; // s/100m
}

/** Atividade realizada (resumo vindo do Strava/Garmin). */
export interface Activity {
  date: string; // YYYY-MM-DD (local)
  sport: Sport;
  movingTimeS: number;
  distanceM?: number;
  avgWatts?: number;
  normalizedWatts?: number; // weighted_average_watts no Strava
  avgHr?: number;
  sufferScore?: number; // Relative Effort do Strava
}

export interface TssResult {
  tss: number;
  method: "power" | "pace" | "swim_pace" | "hr" | "suffer_score" | "estimate";
}

// ---------------------------------------------------------------------------
// TSS de atividade realizada
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * TSS = horas × IF² × 100 (bike, corrida, FC) e horas × IF³ × 100 na natação (sTSS).
 * Ordem de preferência: potência → ritmo → FC → Relative Effort → estimativa por esporte.
 */
export function activityTss(a: Activity, t: Thresholds): TssResult {
  const h = a.movingTimeS / 3600;
  if (h <= 0) return { tss: 0, method: "estimate" };

  if (a.sport === "bike" && t.ftp && (a.normalizedWatts || a.avgWatts)) {
    const IF = (a.normalizedWatts ?? a.avgWatts!) / t.ftp;
    return { tss: round1(h * IF * IF * 100), method: "power" };
  }
  if (a.sport === "run" && t.runThresholdSecKm && a.distanceM && a.distanceM > 0) {
    const paceSecKm = a.movingTimeS / (a.distanceM / 1000);
    const IF = clamp(t.runThresholdSecKm / paceSecKm, 0.4, 1.2);
    return { tss: round1(h * IF * IF * 100), method: "pace" };
  }
  if (a.sport === "swim" && t.cssSec100m && a.distanceM && a.distanceM > 0) {
    const pace100 = a.movingTimeS / (a.distanceM / 100);
    const IF = clamp(t.cssSec100m / pace100, 0.4, 1.2);
    return { tss: round1(h * IF ** 3 * 100), method: "swim_pace" };
  }
  const lthr = a.sport === "bike" ? (t.bikeLthr ?? t.runLthr) : (t.runLthr ?? t.bikeLthr);
  if (a.avgHr && lthr && (a.sport === "bike" || a.sport === "run" || a.sport === "brick")) {
    const IF = clamp(a.avgHr / lthr, 0.4, 1.1);
    return { tss: round1(h * IF * IF * 100), method: "hr" };
  }
  if (a.sufferScore != null && a.sport !== "strength") {
    return { tss: a.sufferScore, method: "suffer_score" };
  }
  return { tss: round1(h * TSS_PER_HOUR_DEFAULT[a.sport]), method: "estimate" };
}

/** TSS/hora quando não há dado de intensidade (03-carga-de-treino.md). */
const TSS_PER_HOUR_DEFAULT: Record<Sport, number> = {
  swim: 40,
  bike: 55,
  run: 60,
  strength: 35,
  brick: 65,
  race: 90,
  rest: 0,
};

// ---------------------------------------------------------------------------
// TSS de treino planejado
// ---------------------------------------------------------------------------

/** IF aproximado por zona (meio da faixa). */
const IF_BY_ZONE: Record<string, number> = {
  "1": 0.6, "2": 0.72, "3": 0.85, "4": 0.95, "5": 1.05, "5a": 1.01, "5b": 1.08, "5c": 1.2,
};
/** IF aproximado por RPE 1–10. */
const IF_BY_RPE = [0, 0.5, 0.55, 0.62, 0.7, 0.78, 0.85, 0.92, 1.0, 1.08, 1.15];
/** IF por tipo de treino, quando não há estrutura. */
const IF_BY_TYPE: Record<string, number> = {
  rest: 0, recovery: 0.6, endurance: 0.72, long: 0.72, technique: 0.65, openwater: 0.75,
  tempo: 0.83, brick: 0.8, threshold: 0.88, hills: 0.88, intervals: 0.9, vo2max: 0.9,
  sprint: 0.85, race: 0.95,
};

function stepIf(step: WorkoutStep): number {
  const i = step.intensity;
  const mid = i.valueLow != null && i.valueHigh != null ? (i.valueLow + i.valueHigh) / 2 : i.value;
  switch (i.unit) {
    case "percent_ftp":
    case "percent_lthr":
      return mid / 100;
    case "hr_zone":
    case "pace_zone":
      return IF_BY_ZONE[String(mid)] ?? IF_BY_ZONE[String(Math.round(mid))] ?? 0.72;
    case "rpe":
      return IF_BY_RPE[clamp(Math.round(mid), 0, 10)];
    case "css_offset": // segundos a mais (positivo) ou a menos que o CSS por 100 m; ~105 s de CSS como referência
      return clamp(105 / (105 + mid), 0.5, 1.15);
  }
}

/** Duração de um passo em segundos. Distâncias usam o ritmo de limiar/CSS ajustado pelo IF. */
export function stepSeconds(step: WorkoutStep, sport: Sport, t: Thresholds = {}): number {
  const { unit, value } = step.duration;
  switch (unit) {
    case "seconds": return value;
    case "minutes": return value * 60;
    case "hours": return value * 3600;
  }
  const meters =
    unit === "meters" ? value :
    unit === "kilometers" ? value * 1000 :
    unit === "miles" ? value * 1609.34 :
    unit === "yards" ? value * 0.9144 :
    value * 25; // laps: piscina de 25 m
  const IF = stepIf(step) || 0.7;
  if (sport === "swim") return (meters / 100) * ((t.cssSec100m ?? 120) / IF);
  if (sport === "bike") return meters / ((30 / 3.6) * IF); // ~30 km/h no limiar
  return (meters / 1000) * ((t.runThresholdSecKm ?? 330) / IF);
}

function flattenSteps(w: Workout): WorkoutStep[] {
  const s = w.structure;
  if (!s) return [];
  const out: WorkoutStep[] = [...(s.warmup ?? [])];
  for (const item of s.main) {
    if (item.type === "interval_set") {
      const set = item as IntervalSet;
      for (let r = 0; r < set.repeats; r++) out.push(...set.steps);
    } else out.push(item as WorkoutStep);
  }
  out.push(...(s.cooldown ?? []));
  return out;
}

/** Duração da estrutura em minutos (soma dos passos). null se não houver estrutura. */
export function structureMinutes(w: Workout, t: Thresholds = {}): number | null {
  const steps = flattenSteps(w);
  if (!steps.length) return null;
  return steps.reduce((acc, st) => acc + stepSeconds(st, w.sport, t), 0) / 60;
}

/** TSS estimado de um treino planejado. */
export function plannedWorkoutTss(w: Workout, t: Thresholds = {}): number {
  if (w.sport === "rest") return 0;
  if (w.structure?.estimatedTSS != null) return w.structure.estimatedTSS;
  const steps = flattenSteps(w);
  const exponent = w.sport === "swim" ? 3 : 2;
  if (steps.length && w.sport !== "strength") {
    let tss = 0;
    for (const st of steps) {
      const h = stepSeconds(st, w.sport, t) / 3600;
      tss += h * stepIf(st) ** exponent * 100;
    }
    return round1(tss);
  }
  const h = (w.durationMinutes ?? 0) / 60;
  if (w.sport === "strength") return round1(h * TSS_PER_HOUR_DEFAULT.strength);
  const IF = w.rpe ? IF_BY_RPE[clamp(Math.round(w.rpe), 0, 10)] : (IF_BY_TYPE[w.type] ?? 0.72);
  return round1(h * IF ** exponent * 100);
}

// ---------------------------------------------------------------------------
// CTL / ATL / TSB
// ---------------------------------------------------------------------------

export interface LoadPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  /** Forma do dia = CTL − ATL de ontem. */
  tsb: number;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);
}

/** Soma TSS por dia. */
export function dailyTss(acts: { date: string; tss: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of acts) m.set(a.date, (m.get(a.date) ?? 0) + a.tss);
  return m;
}

/**
 * Série diária de carga (constantes de 42 e 7 dias, média exponencial).
 * Comece a série ~90 dias antes de hoje para o CTL estabilizar.
 */
export function loadSeries(
  daily: Map<string, number>,
  from: string,
  to: string,
  start: { ctl: number; atl: number } = { ctl: 0, atl: 0 }
): LoadPoint[] {
  const out: LoadPoint[] = [];
  let { ctl, atl } = start;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const tss = daily.get(d) ?? 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date: d, tss, ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metas semanais até a prova
// ---------------------------------------------------------------------------

/** Aumento de CTL por semana (meio da faixa de 03-carga-de-treino.md). */
export const RAMP_BY_LEVEL: Record<Level, number> = { beginner: 4, intermediate: 6, advanced: 8 };

/** Teto de aumento do TSS semanal por nível (regra dos 10%, 04-periodizacao.md). */
export const MAX_WEEKLY_GROWTH: Record<Level, number> = { beginner: 0.075, intermediate: 0.1, advanced: 0.15 };

/** TSS por hora em treino misto (para converter horas ↔ TSS). */
export const TSS_PER_HOUR_MIXED = 55;

/**
 * Horas semanais no pico por prova (04-periodizacao.md), [mín, máx].
 * O teto de CTL padrão sai daqui: horas × 55 TSS/h ÷ 7 dias.
 */
export const PEAK_HOURS: Record<EventType, [number, number]> = {
  super_sprint: [3, 5],
  sprint: [4, 6],
  olimpico: [6, 9],
  "70.3": [8, 12],
  ironman: [12, 15],
};

/** Teto de CTL padrão: iniciante no mínimo da faixa, intermediário no meio, avançado no máximo. */
export function defaultCtlCap(event: EventType, level: Level): number {
  const [lo, hi] = PEAK_HOURS[event];
  const h = level === "beginner" ? lo : level === "intermediate" ? (lo + hi) / 2 : hi;
  return Math.round((h * TSS_PER_HOUR_MIXED) / 7);
}

/** Polimento (semanas) e TSB-alvo no dia da prova. */
export const EVENT_RULES: Record<EventType, { taperWeeks: number; minWeeks: number; tsb: [number, number] }> = {
  super_sprint: { taperWeeks: 1, minWeeks: 6, tsb: [0, 10] },
  sprint: { taperWeeks: 1, minWeeks: 8, tsb: [0, 10] },
  olimpico: { taperWeeks: 2, minWeeks: 12, tsb: [5, 15] },
  "70.3": { taperWeeks: 2, minWeeks: 16, tsb: [10, 20] },
  ironman: { taperWeeks: 3, minWeeks: 24, tsb: [15, 25] },
};

export interface WeekTarget {
  week: number;
  startDate: string; // segunda-feira
  phase: "Base" | "Construção" | "Pico" | "Polimento";
  recovery: boolean;
  tss: number;
  /** Horas estimadas (TSS ÷ ~55 por hora em treino misto). Só referência. */
  hoursEstimate: number;
  ctlEnd: number;
}

export interface PlanTargets {
  weeks: WeekTarget[];
  projectedRaceDay: { ctl: number; atl: number; tsb: number };
  tsbTarget: [number, number];
  warnings: string[];
}

/** Segunda-feira da semana de `iso`. */
export function mondayOf(iso: string): string {
  const dow = new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = domingo
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export interface TargetsInput {
  today: string;
  eventDate: string;
  eventType: EventType;
  level: Level;
  currentCtl: number;
  currentAtl: number;
  /** TSS semanal médio das últimas 4 semanas (ponto de partida). Padrão: 7 × CTL. */
  recentWeeklyTss?: number;
  /** Teto de CTL. Padrão: defaultCtlCap(eventType, level). */
  ctlCap?: number;
  /** Força ciclos 2:1 (iniciante ou propenso a lesão). Padrão: 2:1 para beginner. */
  cycle?: 3 | 2;
}

/**
 * Gera a meta de TSS de cada semana, da próxima segunda até a semana da prova.
 * - Base/Construção: TSS semanal sobe +7 × rampa por semana (rampa 6 ≈ +42 TSS),
 *   limitado à regra dos 10% do nível e ao teto de CTL (manutenção = 7 × teto).
 * - Recuperação a cada 3:1 (2:1 para iniciante) com 55% da semana de carga anterior.
 * - Pico: 90% da maior semana. Polimento: 60% → 50% → semana da prova 40%.
 */
export function weeklyTargets(inp: TargetsInput): PlanTargets {
  const warnings: string[] = [];
  const rules = EVENT_RULES[inp.eventType];
  const cycle = inp.cycle ?? (inp.level === "beginner" ? 2 : 3);
  const ramp = RAMP_BY_LEVEL[inp.level];
  const cap = inp.ctlCap ?? defaultCtlCap(inp.eventType, inp.level);
  const maxGrowth = MAX_WEEKLY_GROWTH[inp.level];

  let start = mondayOf(inp.today);
  if (start < inp.today) start = addDays(start, 7); // plano começa na próxima segunda
  const raceMonday = mondayOf(inp.eventDate);
  const totalWeeks = daysBetween(start, raceMonday) / 7 + 1;

  if (totalWeeks < 1) throw new Error("Data da prova já passou ou é nesta semana.");
  if (totalWeeks < rules.minWeeks) {
    warnings.push(
      `Só ${totalWeeks} semanas até a prova; o mínimo recomendado para ${inp.eventType} é ${rules.minWeeks}. Meta conservadora (completar).`
    );
  }

  const taper = Math.min(rules.taperWeeks, Math.max(totalWeeks - 1, 0));
  const rest = totalWeeks - taper;
  const peak = rest >= 6 ? Math.max(1, Math.round(rest * 0.12)) : 0;
  const build = Math.round(rest * 0.38);
  const base = rest - peak - build;

  const phaseOf = (i: number): WeekTarget["phase"] =>
    i < base ? "Base" : i < base + build ? "Construção" : i < base + build + peak ? "Pico" : "Polimento";

  const weeks: WeekTarget[] = [];
  let ctl = inp.currentCtl;
  let atl = inp.currentAtl;
  let lastLoadWeekTss = inp.recentWeeklyTss ?? 7 * Math.max(ctl, 15);
  let peakWeekTss = 0;
  let loadStreak = 0;

  for (let i = 0; i < totalWeeks; i++) {
    const phase = phaseOf(i);
    let recovery = false;
    let tss: number;

    if (phase === "Base" || phase === "Construção") {
      if (loadStreak >= cycle) {
        recovery = true;
        loadStreak = 0;
        tss = 0.55 * lastLoadWeekTss;
      } else {
        const inc = Math.min(7 * ramp, lastLoadWeekTss * maxGrowth);
        tss = Math.min(lastLoadWeekTss + inc, 7 * cap);
        lastLoadWeekTss = tss;
        peakWeekTss = Math.max(peakWeekTss, tss);
        loadStreak++;
      }
    } else if (phase === "Pico") {
      tss = 0.9 * (peakWeekTss || lastLoadWeekTss);
    } else {
      const k = i - (base + build + peak); // 0 = primeira semana de polimento
      const isRaceWeek = i === totalWeeks - 1;
      tss = (peakWeekTss || lastLoadWeekTss) * (isRaceWeek ? 0.4 : k === 0 ? 0.6 : 0.5);
    }

    // simula a semana dia a dia (TSS distribuído igualmente) para projetar CTL/ATL
    const days = i === totalWeeks - 1 ? daysBetween(raceMonday, inp.eventDate) : 7;
    for (let d = 0; d < days; d++) {
      ctl += (tss / 7 - ctl) / 42;
      atl += (tss / 7 - atl) / 7;
    }

    weeks.push({
      week: i + 1,
      startDate: addDays(start, 7 * i),
      phase,
      recovery,
      tss: Math.round(tss),
      hoursEstimate: round1(tss / 55),
      ctlEnd: round1(ctl),
    });
  }

  const tsb = round1(ctl - atl);
  if (tsb < rules.tsb[0]) warnings.push(`TSB projetado no dia da prova (${tsb}) abaixo do alvo ${rules.tsb[0]}–${rules.tsb[1]}: alongar o polimento.`);
  if (tsb > rules.tsb[1] + 5) warnings.push(`TSB projetado (${tsb}) acima do alvo: polimento pode estar longo demais.`);

  return {
    weeks,
    projectedRaceDay: { ctl: round1(ctl), atl: round1(atl), tsb },
    tsbTarget: rules.tsb,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Aderência semanal (07-grupo-e-prontidao.md, seção 3)
// ---------------------------------------------------------------------------

export interface WeekAdherence {
  sessionsPlanned: number;
  sessionsDone: number;
  tssPlanned: number;
  tssDone: number;
  adherence: number; // 0–1, média de sessões e TSS
  decision: "progredir" | "repetir_carga" | "voltar_2_semanas";
}

export function weekAdherence(p: Omit<WeekAdherence, "adherence" | "decision">): WeekAdherence {
  const s = p.sessionsPlanned ? p.sessionsDone / p.sessionsPlanned : 1;
  const t = p.tssPlanned ? Math.min(p.tssDone / p.tssPlanned, 1.2) : 1;
  const adherence = Math.round(((s + Math.min(t, 1)) / 2) * 100) / 100;
  const decision = adherence >= 0.9 ? "progredir" : adherence >= 0.7 ? "repetir_carga" : "voltar_2_semanas";
  return { ...p, adherence, decision };
}
