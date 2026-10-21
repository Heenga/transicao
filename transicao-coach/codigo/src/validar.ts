/**
 * Validador do plano gerado pela IA.
 * Transforma em código as regras de conhecimento/04, 05 e do prompt.
 * Erros = a IA precisa corrigir. Avisos = aceitável, mas vale revisar.
 * As mensagens estão em português para serem devolvidas direto à IA.
 */
import type { TrainingPlan, Workout, TrainingWeek, Sport } from "./schema/plano.js";
import { structureMinutes, plannedWorkoutTss, addDays, daysBetween, type Thresholds } from "./carga.js";

export interface Issue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Mensagem pronta para devolver à IA pedindo correção. */
  feedbackForModel: string;
}

export interface ValidateOptions {
  thresholds?: Thresholds;
  /** Metas de TSS por número de semana (de weeklyTargets). */
  tssTargets?: Record<number, number>;
  /** Tolerância da duração da estrutura vs durationMinutes (min). Padrão 5. */
  durationToleranceMin?: number;
}

const QUALITY = new Set(["tempo", "threshold", "intervals", "vo2max", "sprint", "race", "hills"]);
const ENDURANCE: Sport[] = ["swim", "bike", "run"];

const isQuality = (w: Workout) => QUALITY.has(w.type);

/** Esportes que contam para "mesmo esporte em dias seguidos". Corrida curta de transição não conta. */
function sportsForAdjacency(day: Workout[]): Set<Sport> {
  const s = new Set<Sport>();
  const hasBike = day.some((w) => w.sport === "bike" || w.sport === "brick");
  for (const w of day) {
    if (w.sport === "brick") s.add("bike");
    else if (w.sport === "run" && hasBike && (w.type === "brick" || (w.durationMinutes ?? 99) <= 30)) continue;
    else if (ENDURANCE.includes(w.sport)) s.add(w.sport);
  }
  return s;
}

export function validatePlan(plan: TrainingPlan, opt: ValidateOptions = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const tol = opt.durationToleranceMin ?? 5;
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  // ---- Estrutura geral ---------------------------------------------------
  if (!plan?.meta?.eventDate) err("meta.eventDate", "Data da prova ausente.");
  if (!Array.isArray(plan?.weeks) || plan.weeks.length === 0) {
    err("weeks", "Plano sem semanas.");
    return finish();
  }

  const allDays: { date: string; workouts: Workout[]; path: string }[] = [];
  const ids = new Set<string>();
  let weeksSinceRecovery = 0;
  let prevLongRunKm = 0;
  let prevLongRideKm = 0;

  plan.weeks.forEach((wk: TrainingWeek, wi) => {
    const wp = `weeks[${wi}] (semana ${wk.weekNumber})`;

    if (wi > 0 && daysBetween(plan.weeks[wi - 1].startDate, wk.startDate) !== 7)
      err(wp, `startDate ${wk.startDate} não é 7 dias após a semana anterior.`);
    if (new Date(wk.startDate + "T12:00:00Z").getUTCDay() !== 1)
      err(wp, `Semana deve começar na segunda-feira (startDate ${wk.startDate}).`);

    let minutes = 0;
    let tss = 0;
    let longRunKm = 0;
    let longRideKm = 0;
    let hardMinutes = 0;
    let enduranceMinutes = 0;

    (wk.days ?? []).forEach((day, di) => {
      const dp = `${wp}.days[${di}] ${day.date}`;
      if (day.date < wk.startDate || day.date > addDays(wk.startDate, 6))
        err(dp, `Dia ${day.date} fora da semana ${wk.startDate}.`);

      const ws = day.workouts ?? [];
      const quality = ws.filter(isQuality);
      if (quality.length > 1)
        err(dp, `Dois treinos de qualidade no mesmo dia (${quality.map((w) => w.name).join(" + ")}).`);

      ws.forEach((w, k) => {
        const p = `${dp}.workouts[${k}] "${w.name}"`;
        if (ids.has(w.id)) err(p, `id duplicado: ${w.id}`);
        ids.add(w.id);

        if (w.sport === "rest") return;
        if (!w.durationMinutes || w.durationMinutes <= 0) err(p, "durationMinutes ausente ou zero.");
        if (!w.structure && w.sport !== "strength")
          warn(p, "Sem structure: não exporta para Garmin/Zwift com passos.");
        if (w.groupSession && !w.groupSessionId) err(p, "groupSession sem groupSessionId.");

        const sm = structureMinutes(w, opt.thresholds);
        if (sm != null && w.durationMinutes) {
          const allTime = !JSON.stringify(w.structure).match(/"unit":"(meters|kilometers|miles|yards|laps)"/);
          const diff = Math.abs(sm - w.durationMinutes);
          if (allTime && diff > tol)
            err(p, `Passos somam ${Math.round(sm)} min mas durationMinutes = ${w.durationMinutes}. Ajuste um dos dois.`);
          else if (!allTime && diff > Math.max(tol * 2, w.durationMinutes * 0.2))
            warn(p, `Passos (com distâncias no ritmo prescrito) somam ~${Math.round(sm)} min vs durationMinutes ${w.durationMinutes}.`);
        }

        minutes += w.durationMinutes ?? 0;
        tss += plannedWorkoutTss(w, opt.thresholds);
        if (ENDURANCE.includes(w.sport) || w.sport === "brick") {
          enduranceMinutes += w.durationMinutes ?? 0;
          if (["threshold", "intervals", "vo2max", "sprint", "race", "hills"].includes(w.type))
            hardMinutes += (w.durationMinutes ?? 0) * 0.4; // ~40% da sessão é o bloco forte
        }
        const km = (w.distanceMeters ?? 0) / 1000;
        if (w.sport === "run") longRunKm = Math.max(longRunKm, km);
        if (w.sport === "bike") longRideKm = Math.max(longRideKm, km);
      });

      allDays.push({ date: day.date, workouts: ws, path: dp });
    });

    // ---- Totais da semana ------------------------------------------------
    const hours = minutes / 60;
    if (wk.summary && Math.abs(wk.summary.totalHours - hours) > 0.15)
      err(wp, `summary.totalHours = ${wk.summary.totalHours}, mas os treinos somam ${hours.toFixed(2)} h.`);
    if (wk.targetHours && Math.abs(hours - wk.targetHours) / wk.targetHours > 0.1)
      warn(wp, `Horas da semana (${hours.toFixed(1)}) fogem mais de 10% de targetHours (${wk.targetHours}).`);

    const target = opt.tssTargets?.[wk.weekNumber];
    if (target && Math.abs(tss - target) / target > 0.15)
      err(wp, `TSS estimado da semana ${Math.round(tss)} vs meta ${target} (fora de ±15%). Ajuste volume ou intensidade.`);

    if (enduranceMinutes > 0 && hardMinutes / enduranceMinutes > 0.25)
      warn(wp, `Intensidade alta: ~${Math.round((hardMinutes / enduranceMinutes) * 100)}% do volume em Z4+ (alvo 15–20%).`);

    // ---- Recuperação e progressão do longo ------------------------------
    const isTaper = /polimento|taper/i.test(wk.phase);
    if (wk.isRecoveryWeek || isTaper) weeksSinceRecovery = 0;
    else if (++weeksSinceRecovery > 4)
      warn(wp, "Mais de 4 semanas seguidas sem semana de recuperação.");

    if (!wk.isRecoveryWeek && !isTaper) {
      if (prevLongRunKm && longRunKm - prevLongRunKm > 3)
        err(wp, `Longo de corrida subiu ${(longRunKm - prevLongRunKm).toFixed(1)} km (máx. +3 km/semana).`);
      if (prevLongRideKm && longRideKm - prevLongRideKm > 20)
        err(wp, `Longo de bike subiu ${(longRideKm - prevLongRideKm).toFixed(0)} km (máx. +20 km/semana).`);
    }
    // semana de recuperação não "zera" a referência: a próxima compara com o último longo de carga
    if (!wk.isRecoveryWeek && !isTaper) {
      if (longRunKm) prevLongRunKm = longRunKm;
      if (longRideKm) prevLongRideKm = longRideKm;
    }
  });

  // ---- Regras entre dias -------------------------------------------------
  allDays.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < allDays.length; i++) {
    const prev = allDays[i - 1];
    const cur = allDays[i];
    if (daysBetween(prev.date, cur.date) !== 1) continue;
    const a = sportsForAdjacency(prev.workouts);
    const b = sportsForAdjacency(cur.workouts);
    for (const s of b) if (a.has(s)) err(cur.path, `${s} em dias seguidos (${prev.date} e ${cur.date}).`);

    // qualidade do mesmo esporte em < 48 h
    for (const qa of prev.workouts.filter(isQuality))
      for (const qb of cur.workouts.filter(isQuality))
        if (qa.sport === qb.sport)
          err(cur.path, `Treinos de qualidade de ${qa.sport} com menos de 48 h de intervalo.`);

    // corrida de qualidade depois de pedal longo
    const longRide = prev.workouts.some((w) => w.sport === "bike" && (w.type === "long" || (w.durationMinutes ?? 0) >= 150));
    if (longRide && cur.workouts.some((w) => w.sport === "run" && isQuality(w)))
      err(cur.path, "Corrida de qualidade no dia seguinte a um pedal longo.");
  }

  return finish();

  function finish(): ValidationResult {
    const fmt = (l: Issue[]) => l.map((i) => `- ${i.path}: ${i.message}`).join("\n");
    const feedbackForModel = errors.length
      ? `O plano tem ${errors.length} erro(s). Corrija só o necessário e devolva o JSON completo:\n${fmt(errors)}` +
        (warnings.length ? `\n\nAvisos (corrija se possível):\n${fmt(warnings)}` : "")
      : "";
    return { ok: errors.length === 0, errors, warnings, feedbackForModel };
  }
}
