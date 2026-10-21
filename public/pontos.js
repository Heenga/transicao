/* Pontuação do Grupo (competição). Regras únicas, usadas para gravar o resumo de cada atleta e para montar o placar.
   Os pontos são calculados POR DIA e cada período (hoje, semana, mês, tudo) é a soma dos dias. Assim o placar
   recalcula na hora a partir dos dias: virar o dia ou a semana nunca deixa número velho na tela.

   Regras:
   - Conta: natação, bike, corrida, transição e força com 10 min ou mais. "Outros" (caminhada etc.) não conta.
   - 10 pontos por hora de treino (cada treino conta no máximo 5 h: relógio esquecido ligado não vira pontuação).
   - 5 pontos por treino, no máximo 2 treinos por dia (dividir um treino em pedaços não rende ponto extra).
   - +20 na semana (segunda a domingo) em que fizer natação, bike e corrida; o bônus entra no dia da 3ª modalidade.
   - Treino registrado à mão que repete um treino sincronizado (mesmo dia, mesma modalidade, duração parecida) não conta em dobro. */
(function (root) {
"use strict";
const RULES = { porHora: 10, maxHorasPorTreino: 5, porTreino: 5, maxTreinosPorDia: 2, bonusTri: 20, minMinutos: 10 };
const SCORED = new Set(["swim", "bike", "run", "brick", "strength"]);
const dayKey = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const noon = k => new Date(k + "T12:00:00");
const addK = (k, n) => { const d = noon(k); d.setDate(d.getDate() + n); return dayKey(d); };
const mondayK = k => { const d = noon(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d); };
const isManual = a => a.src === "manual" || /^m\d/.test(String(a.id || ""));
const fitsSport = (a, b) => a === b || a === "brick" && (b === "bike" || b === "run") || b === "brick" && (a === "bike" || a === "run");

/** Treinos que pontuam (válidos e sem duplicata manual), a partir de `from` (YYYY-MM-DD). */
function scoringActs(acts, from) {
  const xs = (acts || []).filter(a => a && SCORED.has(a.sport) && (a.mov || 0) >= RULES.minMinutos * 60 && (!from || dayKey(a.date) >= from));
  // mesmo treino vindo de duas fontes (ex.: Strava e arquivo do Garmin): começa até 10 min de diferença, duração parecida
  const kept = [];
  for (const a of [...xs].sort((p, q) => String(p.date).localeCompare(String(q.date))))
    if (!kept.some(k => !isManual(k) && !isManual(a) && fitsSport(k.sport, a.sport) && Math.abs(new Date(k.date) - new Date(a.date)) <= 600e3 && Math.abs(k.mov - a.mov) <= .25 * Math.max(k.mov, a.mov))) kept.push(a);
  const synced = kept.filter(a => !isManual(a));
  return kept.filter(a => !isManual(a) || !synced.some(s => dayKey(s.date) === dayKey(a.date) && fitsSport(s.sport, a.sport) && Math.abs(s.mov - a.mov) <= Math.max(600, .25 * Math.max(s.mov, a.mov))));
}

/** Resumo por dia: { "YYYY-MM-DD": { p, n, ms, mb, mr, mx, ds, db, dr } } (minutos e metros por modalidade). */
function daily(acts, from) {
  const days = {}, triWeeks = new Set(), sportsByWeek = {};
  const xs = scoringActs(acts, from).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const a of xs) {
    const k = dayKey(a.date), d = days[k] ||= { p: 0, n: 0, ms: 0, mb: 0, mr: 0, mx: 0, ds: 0, db: 0, dr: 0, _sec: 0 };
    const sec = Math.min(a.mov, RULES.maxHorasPorTreino * 3600), min = Math.round(a.mov / 60);
    d._sec += sec; d.n++;
    if (a.sport === "swim") { d.ms += min; d.ds += a.dist || 0; }
    else if (a.sport === "bike") { d.mb += min; d.db += a.dist || 0; }
    else if (a.sport === "run" || a.sport === "brick") { d.mr += min; d.dr += a.dist || 0; }
    else d.mx += min;
    // bônus das 3 modalidades: uma vez por semana, no dia em que a 3ª modalidade aparece
    const wk = mondayK(k), set = sportsByWeek[wk] ||= new Set();
    if (a.sport === "brick") { set.add("bike"); set.add("run"); } else set.add(a.sport);
    if (!triWeeks.has(wk) && set.has("swim") && set.has("bike") && set.has("run")) { triWeeks.add(wk); d.tri = 1; }
  }
  for (const d of Object.values(days)) {
    d.p = Math.round(d._sec / 3600 * RULES.porHora + Math.min(d.n, RULES.maxTreinosPorDia) * RULES.porTreino + (d.tri ? RULES.bonusTri : 0));
    delete d._sec;
  }
  return days;
}

/** Início de cada período (YYYY-MM-DD), nunca antes do início da competição. */
function periodStartKey(k, today, rankStart) {
  const st = k === "dia" ? today : k === "semana" ? mondayK(today) : k === "mes" ? today.slice(0, 8) + "01" : rankStart;
  return rankStart && st < rankStart ? rankStart : st;
}

/** Soma dos dias de um período. */
function sumPeriod(days, from, to) {
  const out = { points: 0, hours: 0, sessions: 0, swim_m: 0, bike_km: 0, run_km: 0, min: 0 };
  for (const [k, d] of Object.entries(days || {})) {
    if (k < from || k > to) continue;
    out.points += d.p; out.sessions += d.n; out.min += d.ms + d.mb + d.mr + d.mx;
    out.swim_m += d.ds; out.bike_km += d.db / 1000; out.run_km += d.dr / 1000;
  }
  out.hours = +(out.min / 60).toFixed(1); out.swim_m = Math.round(out.swim_m); out.bike_km = +out.bike_km.toFixed(1); out.run_km = +out.run_km.toFixed(1);
  delete out.min;
  return out;
}

/** Dias seguidos com treino (até hoje, ou até ontem se ainda não treinou hoje) e semanas seguidas com 4+ treinos. */
function streaks(days, today) {
  let d = days[today] ? today : addK(today, -1), sd = 0;
  while (days[d]) { sd++; d = addK(d, -1); }
  const weekN = wk => { let n = 0; for (let i = 0; i < 7; i++) n += days[addK(wk, i)]?.n || 0; return n; };
  let wk = mondayK(today), sw = weekN(wk) >= 4 ? 1 : 0;
  for (wk = addK(wk, -7); weekN(wk) >= 4; wk = addK(wk, -7)) sw++;
  return { streakDays: sd, streakWeeks: sw };
}

/** Minutos por modalidade nas últimas 12 semanas (para o mini gráfico de cada atleta). */
function weeks12(days, today) {
  const mon = mondayK(today);
  return Array.from({ length: 12 }, (_, i) => { const ws = addK(mon, -7 * (11 - i)), w = { s: 0, b: 0, r: 0, o: 0 };
    for (let j = 0; j < 7; j++) { const d = days[addK(ws, j)]; if (d) { w.s += d.ms; w.b += d.mb; w.r += d.mr; w.o += d.mx; } }
    return w; });
}

const PERIOD_KEYS = ["dia", "semana", "mes", "periodo"];
/** Estatísticas de todos os períodos a partir dos dias. */
function periods(days, today, rankStart) {
  return Object.fromEntries(PERIOD_KEYS.map(k => [k, sumPeriod(days, periodStartKey(k, today, rankStart), today)]));
}

/**
 * Card de um atleta no placar, recalculado HOJE a partir dos dias gravados. Mantém os campos que não dependem do
 * período (condicionamento, aderência, conquistas). Doc antigo sem `days` → null (o app usa o caminho antigo).
 */
function view(doc, today, rankStart) {
  if (!doc || !doc.days) return null;
  const ps = periods(doc.days, today, rankStart), old = doc.periods || {};
  for (const k of PERIOD_KEYS) Object.assign(ps[k], { forma: old[k]?.forma ?? doc.forma ?? null, forma_ini: old[k]?.forma_ini ?? null });
  const w = ps.semana;
  return { ...doc, periods: ps, points: w.points, week: { swim_m: w.swim_m, bike_km: w.bike_km, run_km: w.run_km, hours: w.hours, sessions: w.sessions },
    ...streaks(doc.days, today), weeks12: weeks12(doc.days, today) };
}

const Pontos = { RULES, scoringActs, daily, periodStartKey, sumPeriod, periods, streaks, weeks12, view, util: { dayKey, mondayK, addK } };
root.Pontos = Pontos;
if (typeof module !== "undefined" && module.exports) module.exports = Pontos;
})(typeof window !== "undefined" ? window : globalThis);
