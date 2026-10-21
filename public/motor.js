/* Motor de treino do Transição (v2).
   Adaptado do transicao-coach (base: claude-coach, MIT © Felix Rieseberg) para o formato de treino do app
   (sessoes / titulo / min / zona / etapas). Sem dependências: roda no navegador (window.Motor) e no Node (testes).

   O que é calculado aqui, em código, e entregue pronto para a IA:
   - limiares de cada atleta a partir dos testes de nivelamento (pace de limiar, FC de limiar, FTP, CSS);
   - carga de cada treino feito (potência → pace → CSS → FC de limiar própria → esforço 1–10 → referência);
   - fases ancoradas na data da prova (as mesmas semanas para o grupo todo, recuperação 3:1 alinhada);
   - meta de carga da semana (rampa por nível, teto pelas horas disponíveis, polimento);
   - prontidão do dia (verde / amarelo / vermelho / doença) a partir do check-in e do equilíbrio;
   - validação dos treinos que a IA devolve, com o texto de correção para mandar de volta. */
(function (root) {
"use strict";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = v => Math.round(v * 10) / 10;
const DAY = 864e5;
const iso = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const atNoon = k => new Date(String(k).slice(0, 10) + "T12:00:00");
const mondayKey = k => { const d = atNoon(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const addDaysKey = (k, n) => { const d = atNoon(k); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((atNoon(b) - atNoon(a)) / DAY);
const avg = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

/* ---------------- limiares (testes de nivelamento do app) ---------------- */

/** FC de limiar de referência quando o atleta ainda não fez teste (é o valor que o app sempre usou). */
const LTHR_REF = 168;

/** Limiares a partir de profile.testes (mesmas fórmulas da tela de testes). Campos ausentes = desconhecido. */
function thresholdsFromTests(testes) {
  const t = testes || {}, out = {};
  const run = t.run, bike = t.bike, swim = t.swim;
  if (run && !run.caminhou && run.dist_km > 0) {
    out.runPace = Math.round((1200 / run.dist_km) * 1.03); // s/km no limiar (teste de 20 min)
    if (run.hr) out.runLthr = Math.round(run.hr * 0.97);
  }
  if (bike) {
    if (bike.watts) out.ftp = Math.round(bike.watts * 0.95);
    if (bike.hr) out.bikeLthr = Math.round(bike.hr * 0.95);
  }
  if (swim && swim.t400 && swim.t200 && swim.t400 > swim.t200) out.css = (swim.t400 - swim.t200) / 2; // s/100 m
  return out;
}

/* ---------------- carga de treino feito ---------------- */

/** Intensidade média por modalidade quando não há FC, esforço nem limiar (valores que o app já usava). */
const IF_DEFAULT = { run: .78, bike: .70, swim: .75, strength: .60, brick: .75, other: .55 };

/** Carga (≈ TSS) de uma atividade do app {sport, mov, dist, hr, rpe, watts}. */
function activityLoad(a, t) {
  t = t || {};
  const h = (a.mov || 0) / 3600;
  if (!h) return { load: 0, method: "vazio" };
  const sq = IF => ({ IF, load: h * IF * IF * 100 });
  if (a.sport === "bike" && t.ftp && a.watts > 0) return { ...sq(clamp(a.watts / t.ftp, .3, 1.5)), method: "potência" };
  if (a.sport === "run" && t.runPace && a.dist > 300) return { ...sq(clamp(t.runPace / (a.mov / (a.dist / 1000)), .4, 1.2)), method: "pace" };
  if (a.sport === "swim" && t.css && a.dist > 50) { const IF = clamp(t.css / (a.mov / (a.dist / 100)), .4, 1.2); return { IF, load: h * IF ** 3 * 100, method: "ritmo de natação" }; }
  const lthr = a.sport === "bike" ? (t.bikeLthr || t.runLthr) : (t.runLthr || t.bikeLthr);
  if (a.hr && lthr && (a.sport === "bike" || a.sport === "run" || a.sport === "brick")) return { ...sq(clamp(a.hr / lthr, .5, 1.15)), method: "FC de limiar" };
  if (a.rpe) return { ...sq(0.45 + 0.055 * a.rpe), method: "esforço" };
  if (a.hr) return { ...sq(clamp(a.hr / LTHR_REF, .5, 1.15)), method: "FC (referência)" };
  return { ...sq(IF_DEFAULT[a.sport] ?? .55), method: "estimada" };
}

/* ---------------- carga de treino planejado ---------------- */

const ZONE_IF = { 1: .6, 2: .72, 3: .85, 4: .95, 5: 1.05 };
const EASY_RE = /aquec|desaquec|solto|regenera|caminh|recupera|educativ|técnica|tecnica|mobilidade/i;
const HARD_RE = /\bZ[45]\b|limiar|intervalad|tiros?\b|teste|VO2|sub-?limiar|sweet ?spot|ritmo de prova|forte/i;
const zonesIn = txt => (String(txt || "").match(/Z([1-5])/gi) || []).map(z => +z[1]);
const maxZone = s => Math.max(0, ...zonesIn(s.zona), ...(s.etapas || []).flatMap(e => zonesIn(`${e.fase} ${e.desc}`)));

/** Sessão de qualidade (forte): zona 4–5 em algum ponto ou título/etapas de tiro, limiar, teste. */
function isHard(s) {
  if (!s || s.sport === "strength" || s.sport === "rest") return false;
  if (maxZone(s) >= 4) return true;
  return HARD_RE.test(`${s.titulo || ""} ${(s.etapas || []).map(e => e.desc).join(" ")}`) && !/sem (tiros|forte)|nada forte/i.test(s.titulo || "");
}

/** Carga estimada de uma sessão planejada, pelas etapas (zona de cada parte) ou pela zona da sessão. */
function sessionLoad(s) {
  const min = Number(s.min) || 0;
  if (!min || s.sport === "rest") return 0;
  if (s.sport === "strength") return min / 60 * 35;
  const exp = s.sport === "swim" ? 3 : 2;
  const sz = zonesIn(s.zona), sessZ = sz.length ? Math.max(...sz) : 2;
  const parts = (s.etapas || []).filter(e => Number(e.min) > 0);
  let used = 0, load = 0;
  for (const e of parts) {
    const z = zonesIn(`${e.fase || ""} ${e.desc || ""}`);
    const zone = clamp(z.length ? avg(z) : EASY_RE.test(`${e.fase} ${e.desc}`) ? 1.5 : sessZ, 1, 5);
    const lo = Math.floor(zone), IF = ZONE_IF[lo] + (ZONE_IF[Math.ceil(zone)] - ZONE_IF[lo]) * (zone - lo);
    load += (e.min / 60) * IF ** exp * 100; used += Number(e.min);
  }
  if (used < min) load += ((min - used) / 60) * ZONE_IF[clamp(sessZ, 1, 5)] ** exp * 100;
  return load;
}

/* ---------------- fases ancoradas na prova ---------------- */

/** Semanas de polimento, pico (específico) e construção por prova; o resto até a prova é base. */
const EVENTS = {
  super_sprint: { taper: 1, peak: 2, build: 5, minWeeks: 6, peakHours: [3, 5], tsb: [0, 10] },
  sprint: { taper: 1, peak: 2, build: 6, minWeeks: 8, peakHours: [4, 6], tsb: [0, 10] },
  olimpico: { taper: 2, peak: 3, build: 10, minWeeks: 12, peakHours: [6, 9], tsb: [5, 15] },
  "703": { taper: 2, peak: 3, build: 12, minWeeks: 16, peakHours: [8, 12], tsb: [10, 20] },
  ironman: { taper: 3, peak: 4, build: 14, minWeeks: 24, peakHours: [12, 15], tsb: [15, 25] },
};
const eventOf = type => EVENTS[String(type || "").replace("70.3", "703")] || EVENTS.olimpico;
const PHASE_NOTE = {
  Base: "volume aeróbico, técnica de natação, força, pouco trabalho forte",
  "Construção": "aumentar limiar e VO2, manter o volume aeróbico, bricks semanais",
  "Específico": "sessões no ritmo de prova, bricks e simulação de prova",
  Polimento: "reduzir volume 40–60% e manter estímulos curtos de intensidade",
  "Transição": "prova já passou: 1–2 semanas leves e sem estrutura",
};

/** Fase de uma semana: `w` = semanas entre a segunda desta semana e a segunda da semana da prova (0 = semana da prova).
    Função só da data da prova, então os 4 atletas têm as mesmas fases e as mesmas semanas de recuperação. */
function weekPhase(w, type) {
  const e = eventOf(type);
  if (w == null) return { fase: "Base", recuperacao: false, nota: "sem data de prova" };
  if (w < 0) return { fase: "Transição", recuperacao: false, nota: PHASE_NOTE["Transição"] };
  if (w < e.taper) return { fase: "Polimento", recuperacao: false, semanaDaProva: w === 0, nota: PHASE_NOTE.Polimento };
  if (w < e.taper + e.peak) return { fase: "Específico", recuperacao: false, nota: PHASE_NOTE["Específico"] };
  const fase = w < e.taper + e.peak + e.build ? "Construção" : "Base";
  // ciclo 3:1 contado a partir do início do específico: …, R, carga, carga, carga | específico
  const recuperacao = (w - e.taper - e.peak) % 4 === 3;
  return { fase, recuperacao, nota: recuperacao ? "semana de recuperação: volume −30 a −40%, nada de Z4+" : PHASE_NOTE[fase] };
}
const weeksToRace = (todayKey, raceDate) => raceDate ? Math.floor(daysBetween(mondayKey(todayKey), mondayKey(raceDate)) / 7) : null;

/* ---------------- meta de carga semanal ---------------- */

const RAMP = { beginner: 4, intermediate: 6, advanced: 8 };        // aumento de CTL por semana
const GROWTH = { beginner: .075, intermediate: .10, advanced: .15 }; // regra dos 10%
const LOAD_PER_HOUR = 55;                                            // carga por hora em treino misto
const levelOfTier = tier => ({ A: "beginner", B: "intermediate", C: "advanced" })[tier] || "intermediate";

/** Horas da semana de pico: faixa da prova, ajustada pelo nível e limitada às horas disponíveis. */
function peakHours(type, level, hours) {
  const [lo, hi] = eventOf(type).peakHours;
  const byLevel = level === "beginner" ? lo : level === "advanced" ? hi : (lo + hi) / 2;
  return Math.min(hours || Infinity, hi, byLevel + 1.5);
}

/**
 * Metas desta semana e das próximas, recalculadas toda semana a partir da carga real (se o atleta treinou menos,
 * a meta acompanha; se treinou tudo, progride). A progressão é espalhada até o específico para não encostar no teto cedo.
 * inp: { today, raceDate, raceType, level, hours, recentWeekly (média das últimas 4 semanas), ctl, weeks }
 */
function weekTargets(inp) {
  const e = eventOf(inp.raceType), level = inp.level || "intermediate", warnings = [];
  const hours = Number(inp.hours) || 6;
  const peakLoad = Math.round(peakHours(inp.raceType, level, hours) * LOAD_PER_HOUR);
  const weekCap = hours * 60; // não passa das horas disponíveis
  const w0 = weeksToRace(inp.today, inp.raceDate);
  const floor = Math.min(hours, 6) * 0.5 * LOAD_PER_HOUR; // quem está sem histórico começa com ~metade das horas
  const start = Math.max(inp.recentWeekly || 0, 7 * (inp.ctl || 0), floor);
  if (w0 != null && w0 >= 0 && w0 + 1 < e.minWeeks) warnings.push(`Faltam ${w0 + 1} semanas; o mínimo recomendado para esta prova é ${e.minWeeks}. Meta conservadora (completar bem).`);

  // semanas de carga até o específico (para espalhar a progressão)
  let loadWeeks = 0;
  if (w0 != null) for (let w = w0; w >= e.taper + e.peak; w--) if (!weekPhase(w, inp.raceType).recuperacao) loadWeeks++;
  const inc = Math.min(7 * RAMP[level], start * GROWTH[level], Math.max(0, (peakLoad - start) / Math.max(1, loadWeeks)));

  const out = [];
  let last = start, top = start;
  const n = inp.weeks || 1;
  for (let i = 0; i < n; i++) {
    const w = w0 == null ? null : w0 - i, ph = weekPhase(w, inp.raceType);
    let meta;
    if (ph.fase === "Transição") meta = 0.4 * start;
    else if (ph.recuperacao) meta = 0.6 * last;
    else if (ph.fase === "Base" || ph.fase === "Construção") { last = Math.max(last, Math.min(last + inc, Math.max(peakLoad, start))); top = Math.max(top, last); meta = last; }
    else if (ph.fase === "Específico") meta = 0.9 * Math.max(top, last);
    else meta = Math.max(top, last) * (ph.semanaDaProva ? 0.4 : w === e.taper - 1 ? 0.6 : 0.5); // 1ª semana de polimento 60%, depois 50%, semana da prova 40%
    meta = Math.min(meta, weekCap);
    out.push({ inicio: addDaysKey(mondayKey(inp.today), 7 * i), semanasParaProva: w, fase: ph.fase, recuperacao: ph.recuperacao, nota: ph.nota, meta: Math.round(meta), horas: r1(meta / LOAD_PER_HOUR) });
  }
  return { semanas: out, cargaDePico: peakLoad, pontoDePartida: Math.round(start), avisos: warnings };
}

/** Planejado × feito de uma semana → decisão (07-grupo-e-prontidao, seção 3). */
function weekAdherence(p) {
  const s = p.sessoesPlanejadas ? p.sessoesFeitas / p.sessoesPlanejadas : 1;
  const t = p.cargaPlanejada ? Math.min(p.cargaFeita / p.cargaPlanejada, 1) : 1;
  const aderencia = Math.round(((s + t) / 2) * 100);
  const decisao = aderencia >= 90 ? "progredir" : aderencia >= 70 ? "repetir a carga (não progredir)" : "voltar à carga de 2 semanas atrás e manter só os treinos-chave";
  return { ...p, aderencia, decisao };
}

/* ---------------- prontidão do dia ---------------- */

const ILLNESS_RE = /febre|gripe|gripad|doente|resfriad|covid|garganta|dor aguda|virose/i;

/** checkins: [{data, sono, score, qual, hrv, bb, rhr, cans, obs}] (como o app guarda). */
function readiness(checkins, opt) {
  opt = opt || {};
  const today = opt.today || iso(new Date());
  const list = (checkins || []).filter(c => c && c.data && c.data <= today).sort((a, b) => a.data.localeCompare(b.data));
  const inLast = n => list.filter(c => daysBetween(c.data, today) < n);
  const alerts = [], last = list.at(-1), fresh = last && daysBetween(last.data, today) <= 1 ? last : null;
  const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;

  if (fresh && ILLNESS_RE.test(fresh.obs || "")) return { status: "doenca", alerts: ["Você relatou sintoma de doença ou dor aguda"], comDados: true };

  // HRV: média de 7 dias × linha de base (8 a 60 dias atrás)
  const hrv7 = inLast(7).map(c => num(c.hrv)).filter(v => v), hrvBase = list.filter(c => { const d = daysBetween(c.data, today); return d >= 7 && d < 60; }).map(c => num(c.hrv)).filter(v => v);
  if (hrv7.length >= 2 && hrvBase.length >= 4) { const h = avg(hrv7), b = avg(hrvBase), drop = (b - h) / b; if (drop >= .1) alerts.push(`HRV média de 7 dias ${Math.round(h)} ms, ${Math.round(drop * 100)}% abaixo do seu normal (${Math.round(b)} ms)`); }

  // FC de repouso
  const rhrBase = list.filter(c => { const d = daysBetween(c.data, today); return d >= 3 && d < 60; }).map(c => num(c.rhr)).filter(v => v);
  const rhr3 = inLast(3).map(c => num(c.rhr)).filter(v => v);
  if (rhrBase.length >= 4) {
    const b = avg(rhrBase);
    if (rhr3.length >= 3 && rhr3.every(x => x >= b + 5)) alerts.push(`FC de repouso ${Math.round(b) + 5}+ bpm há 3 dias (normal ${Math.round(b)})`);
    else if (fresh && num(fresh.rhr) && num(fresh.rhr) <= b - 8) alerts.push(`FC de repouso ${fresh.rhr} bpm, bem abaixo do normal: pode ser início de doença`);
  }

  // sono: 2 noites curtas ou com nota baixa, ou 1 noite muito curta
  const last2 = inLast(2);
  const shortN = last2.filter(c => num(c.sono) != null && num(c.sono) < 6).length, lowScore = last2.filter(c => num(c.score) != null && num(c.score) < 60).length;
  if (last2.length === 2 && (shortN === 2 || lowScore === 2)) alerts.push("Sono curto ou de baixa qualidade nas últimas 2 noites");
  else if (fresh && num(fresh.sono) != null && num(fresh.sono) < 5) alerts.push(`Só ${fresh.sono} h de sono na última noite`);

  if (fresh && num(fresh.bb) != null && num(fresh.bb) < 40) alerts.push(`Body Battery ${fresh.bb} ao acordar (abaixo de 40)`);

  const last3 = inLast(3);
  if (last3.length >= 3 && last3.every(c => num(c.cans) >= 4)) alerts.push("Cansaço 4 ou 5 há 3 dias");
  const sleepAndFatigue = fresh && num(fresh.cans) >= 4 && ((num(fresh.qual) != null && num(fresh.qual) <= 2) || (num(fresh.sono) != null && num(fresh.sono) < 6));
  if (sleepAndFatigue) alerts.push("Sono ruim e cansaço alto juntos (risco de esgotamento)");

  if (opt.tsb != null && opt.tsb < -30) alerts.push(`Equilíbrio ${Math.round(opt.tsb)} (sobrecarga)`);

  const hardRed = (opt.tsb != null && opt.tsb < -30) || sleepAndFatigue;
  const status = hardRed || alerts.length >= 2 ? "vermelho" : alerts.length === 1 ? "amarelo" : "verde";
  return { status, alerts, comDados: !!fresh };
}
const READINESS_ACTION = {
  verde: "manter o plano",
  amarelo: "treino de qualidade vira versão mais curta (−25 a −30% do bloco principal) ou troca de dia com uma sessão leve; cortar treino duplo",
  vermelho: "trocar por descanso ou 30 min em Z1; nada de Z4+ por 48 h; se durar 3+ dias, antecipar a semana de recuperação",
  doenca: "descanso; não reajustar carga até melhorar; procurar médico se persistir",
};

/* ---------------- validação dos treinos da IA ---------------- */

const kmOf = s => { const m = String(s.dist || "").replace(/\./g, "").replace(",", ".").match(/([\d.]+)\s*(km|m)\b/i); if (!m) return null; return m[2].toLowerCase() === "km" ? +m[1] : +m[1] / 1000; };
/** Esportes que contam para "mesmo esporte em dias seguidos": a corrida curta depois da bike (brick) não conta. */
function adjacencySports(ss) {
  const out = new Set(), hasBike = ss.some(s => s.sport === "bike" || s.sport === "brick");
  for (const s of ss) {
    if (s.sport === "brick") out.add("bike");
    else if (s.sport === "run" && hasBike && (Number(s.min) || 99) <= 30) continue;
    else if (["swim", "bike", "run"].includes(s.sport)) out.add(s.sport);
  }
  return out;
}
const hardSports = ss => new Set(ss.filter(isHard).map(s => s.sport === "brick" ? "run" : s.sport));
const longBike = ss => ss.some(s => (s.sport === "bike" || s.sport === "brick") && ((Number(s.bike_min) || (s.sport === "bike" ? Number(s.min) : 0)) >= 150 || /long/i.test(s.titulo || "") && s.sport === "bike"));

/**
 * dias: [{data, sessoes}] devolvidos pela IA (já sem descanso). ctx:
 *  { meta, cargaFeita, minutosFeitos, horas, diaAnterior:{data,sessoes}, manterModalidades:{data:[sports]},
 *    maiorCorridaKm, maiorCorridaMin, maiorBikeKm, maiorBikeMin }
 */
function validateDays(dias, ctx) {
  ctx = ctx || {};
  const errors = [], warnings = [];
  const E = (d, m) => errors.push(`${d}: ${m}`), W = (d, m) => warnings.push(`${d}: ${m}`);
  const days = [...(dias || [])].sort((a, b) => a.data.localeCompare(b.data));
  let load = 0, minutes = 0, hardMin = 0, endMin = 0;

  days.forEach(d => {
    const ss = d.sessoes || [];
    ss.forEach(s => {
      const nm = `"${s.titulo || s.sport}"`, min = Number(s.min) || 0;
      if (!min) E(d.data, `${nm} sem "min".`);
      const et = (s.etapas || []).filter(e => Number(e.min) > 0), sum = et.reduce((t, e) => t + Number(e.min), 0);
      if (s.sport !== "strength" && !et.length) W(d.data, `${nm} sem etapas (o relógio não guia o treino).`);
      if (et.length && Math.abs(sum - min) > Math.max(3, min * .05)) E(d.data, `${nm}: as etapas somam ${sum} min, mas "min" = ${min}. A duração tem que fechar.`);
      if (s.sport === "brick" && s.bike_min && s.run_min && Math.abs(s.bike_min + s.run_min - min) > 2) E(d.data, `${nm}: bike_min + run_min = ${s.bike_min + s.run_min}, mas "min" = ${min}.`);
      if ((s.sport === "run" || s.sport === "brick") && !s.pace) W(d.data, `${nm} sem pace alvo.`);
      if (s.sport === "run") {
        const km = kmOf(s);
        if (km && ctx.maiorCorridaKm && km > ctx.maiorCorridaKm + 3) E(d.data, `${nm}: ${r1(km)} km, mas a maior corrida recente foi ${r1(ctx.maiorCorridaKm)} km (máx. +3 km).`);
        else if (!km && ctx.maiorCorridaMin && min > ctx.maiorCorridaMin + 20) E(d.data, `${nm}: ${min} min, mas a maior corrida recente foi ${ctx.maiorCorridaMin} min (máx. +20 min).`);
      }
      if (s.sport === "bike") {
        const km = kmOf(s);
        if (km && ctx.maiorBikeKm && km > ctx.maiorBikeKm + 20) E(d.data, `${nm}: ${Math.round(km)} km, mas o maior pedal recente foi ${Math.round(ctx.maiorBikeKm)} km (máx. +20 km).`);
        else if (!km && ctx.maiorBikeMin && min > ctx.maiorBikeMin + 45) E(d.data, `${nm}: ${min} min, mas o maior pedal recente foi ${ctx.maiorBikeMin} min (máx. +45 min).`);
      }
      load += sessionLoad(s); minutes += min;
      if (["swim", "bike", "run", "brick"].includes(s.sport)) { endMin += min; if (isHard(s)) hardMin += min * .4; }
    });
    const hard = ss.filter(isHard);
    if (hard.length > 1) E(d.data, `dois treinos de qualidade no mesmo dia (${hard.map(s => s.titulo).join(" + ")}). Um forte, o outro leve.`);
    const keep = ctx.manterModalidades?.[d.data];
    if (keep) {
      const a = [...keep].sort().join(","), b = ss.map(s => s.sport).sort().join(",");
      if (a !== b) E(d.data, `mantenha as modalidades do dia (${keep.join(" + ") || "descanso"}); veio ${ss.map(s => s.sport).join(" + ") || "descanso"}.`);
    }
  });
  if (ctx.manterModalidades) for (const [k, sp] of Object.entries(ctx.manterModalidades)) if (sp.length && !days.some(d => d.data === k)) E(k, `faltou o dia (mantenha ${sp.join(" + ")}).`);

  // regras entre dias (inclui o dia anterior à janela)
  const seq = ctx.diaAnterior ? [ctx.diaAnterior, ...days] : days;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (daysBetween(a.data, b.data) !== 1) continue;
    const ha = hardSports(a.sessoes || []), hb = hardSports(b.sessoes || []);
    for (const s of hb) if (ha.has(s)) E(b.data, `treino de qualidade de ${s} com menos de 48 h do anterior (${a.data}).`);
    if (longBike(a.sessoes || []) && (b.sessoes || []).some(s => s.sport === "run" && isHard(s))) E(b.data, "corrida forte no dia seguinte a um pedal longo.");
    const aa = adjacencySports(a.sessoes || []);
    for (const s of adjacencySports(b.sessoes || [])) if (aa.has(s)) W(b.data, `${s} em dias seguidos (${a.data} e ${b.data}); prefira espalhar.`);
  }

  // carga e horas da semana
  if (ctx.meta) {
    const restante = ctx.meta - (ctx.cargaFeita || 0), base = Math.max(restante, ctx.meta * .15);
    const diff = (load - restante) / base;
    const msg = `carga planejada ${Math.round(load)} para uma meta restante de ${Math.round(Math.max(0, restante))} (meta da semana ${ctx.meta}, já feito ${Math.round(ctx.cargaFeita || 0)}).`;
    if (days.length >= 3 && Math.abs(diff) > .25) E("semana", msg + (diff > 0 ? " Reduza volume ou intensidade." : " Aumente um pouco o volume em Z2."));
    else if (Math.abs(diff) > .25) W("semana", msg);
  }
  if (ctx.horas && (ctx.minutosFeitos || 0) + minutes > ctx.horas * 60 * 1.1) E("semana", `${Math.round(((ctx.minutosFeitos || 0) + minutes) / 6) / 10} h na semana, acima das ${ctx.horas} h disponíveis.`);
  if (endMin > 0 && hardMin / endMin > .25) W("semana", `intensidade alta: ~${Math.round(hardMin / endMin * 100)}% do tempo forte (alvo 15–20%).`);

  const fmt = l => l.map(x => "- " + x).join("\n");
  return {
    ok: !errors.length, errors, warnings, carga: Math.round(load), minutos: minutes,
    feedback: errors.length ? `Os treinos têm ${errors.length} problema(s). Corrija só o necessário e devolva o JSON completo no mesmo formato:\n${fmt(errors)}${warnings.length ? `\n\nAvisos (corrija se der):\n${fmt(warnings)}` : ""}` : "",
  };
}

/* ---------------- zonas individuais (texto curto para a IA e para a tela) ---------------- */
const mmss = s => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
function zonesText(t) {
  const out = {};
  if (t.runPace) { const T = t.runPace; out.corrida_pace = `limiar ${mmss(T)}/km · Z1 > ${mmss(T + 90)} · Z2 ${mmss(T + 50)}–${mmss(T + 80)} · Z3 ${mmss(T + 15)}–${mmss(T + 30)} · Z4 ${mmss(T - 5)}–${mmss(T + 8)} · Z5 ${mmss(T - 25)}–${mmss(T - 12)}/km`; }
  if (t.runLthr) { const L = t.runLthr; out.corrida_fc = `FC de limiar ${L} · Z1 < ${Math.round(L * .81)} · Z2 ${Math.round(L * .81)}–${Math.round(L * .89)} · Z3 ${Math.round(L * .90)}–${Math.round(L * .93)} · Z4 ${Math.round(L * .94)}–${Math.round(L * .99)} · Z5 ${Math.round(L * 1.0)}+ bpm`; }
  if (t.ftp) { const F = t.ftp; out.bike_potencia = `FTP ${F} W · Z1 < ${Math.round(F * .55)} · Z2 ${Math.round(F * .56)}–${Math.round(F * .75)} · Z3 ${Math.round(F * .76)}–${Math.round(F * .90)} · Z4 ${Math.round(F * .91)}–${Math.round(F * 1.05)} · Z5 ${Math.round(F * 1.06)}+ W`; }
  if (t.bikeLthr) { const L = t.bikeLthr; out.bike_fc = `FC de limiar ${L} · Z2 ${Math.round(L * .81)}–${Math.round(L * .89)} · Z4 ${Math.round(L * .94)}–${Math.round(L * .99)} bpm`; }
  if (t.css) { const C = t.css; out.natacao = `CSS ${mmss(C)}/100 m · Z1 ${mmss(C + 17)} · Z2 ${mmss(C + 10)} · Z3 ${mmss(C + 4)} · Z4 ${mmss(C)} · Z5 ${mmss(C - 4)}/100 m`; }
  return out;
}

const Motor = {
  version: 2, LTHR_REF, IF_DEFAULT, EVENTS, READINESS_ACTION,
  thresholdsFromTests, activityLoad, sessionLoad, isHard, weekPhase, weeksToRace, weekTargets, weekAdherence,
  levelOfTier, peakHours, readiness, validateDays, zonesText, kmOf,
  util: { iso, mondayKey, addDaysKey, daysBetween },
};
root.Motor = Motor;
if (typeof module !== "undefined" && module.exports) module.exports = Motor;
})(typeof window !== "undefined" ? window : globalThis);
