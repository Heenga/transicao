/* Análises do Transição (sem IA, calculadas no aparelho a partir dos treinos, testes e check-ins).
   Usa o motor (public/motor.js) para fases e metas. Cada análise devolve dados + um texto que diz o que fazer.
   - projeção do condicionamento até o dia da prova (seguindo o plano × se continuar como está);
   - eficiência aeróbica: pace na mesma FC ao longo das semanas;
   - tempo estimado de prova por modalidade;
   - quanto falta para as distâncias da prova (maior sessão recente × alvo de pico);
   - risco de lesão pela variação de carga (agudo ÷ crônico) e salto de volume na corrida;
   - tendência de recuperação (HRV, FC de repouso, sono) × o normal do atleta;
   - insights de melhora priorizados.
   Funciona no navegador (window.Analise) e no Node (testes). */
(function (root) {
"use strict";
const Motor = () => root.Motor;
const DAY = 864e5;
const iso = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const noon = k => new Date(String(k).slice(0, 10) + "T12:00:00");
const addK = (k, n) => { const d = noon(k); d.setDate(d.getDate() + n); return iso(d); };
const diffD = (a, b) => Math.round((noon(b) - noon(a)) / DAY);
const avg = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (n, d = 1) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const mmss = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const hms = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sign = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);

/** Distâncias da prova [natação m, bike km, corrida km]. */
const RACE_DIST = { super_sprint: [400, 10, 2.5], sprint: [750, 20, 5], olimpico: [1500, 40, 10], "703": [1900, 90, 21.1], ironman: [3800, 180, 42.2] };
/** Faixa de condicionamento (CTL) com que um amador costuma chegar bem à prova. */
const CTL_BAND = { super_sprint: [25, 45], sprint: [35, 55], olimpico: [45, 70], "703": [60, 85], ironman: [80, 110] };
const raceKey = t => { const k = String(t || "").replace("70.3", "703"); return RACE_DIST[k] ? k : "olimpico"; };

/* ---------------- 1. projeção até a prova ---------------- */
/**
 * inp: { series:[{d, ctl, atl}], today, race:{date,type}, level, hours, recentWeekly, doneThisWeek }
 * Simula dia a dia: até hoje sem treino (a série termina no último treino), depois a meta do motor (plano)
 * ou a média recente constante (como está). Devolve uma série semanal e o dia da prova.
 */
function projection(inp) {
  const M = Motor(); if (!M || !inp.race?.date) return null;
  const today = inp.today, w0 = M.weeksToRace(today, inp.race.date);
  if (w0 == null || w0 < 0) return null;
  const last = inp.series?.length ? inp.series.at(-1) : { d: noon(today), ctl: 0, atl: 0 };
  let ctl = last.ctl, atl = last.atl;
  for (let k = iso(last.d); k < today; k = addK(k, 1)) { ctl -= ctl / 42; atl -= atl / 7; } // dias sem treino até hoje
  const t = M.weekTargets({ today, raceDate: inp.race.date, raceType: inp.race.type, level: inp.level, hours: inp.hours, recentWeekly: inp.recentWeekly, ctl, weeks: w0 + 1 });
  const mon = M.util.mondayKey(today), raceDay = inp.race.date.slice(0, 10), daysLeftThisWeek = Math.max(1, 7 - diffD(mon, today));
  const run = daily => {
    let c = ctl, a = atl; const pts = [{ k: today, ctl: c, atl: a }];
    for (let k = today; k < raceDay; k = addK(k, 1)) { const l = daily(k); c += (l - c) / 42; a += (l - a) / 7; if (noon(k).getDay() === 0 || addK(k, 1) === raceDay) pts.push({ k: addK(k, 1), ctl: c, atl: a }); }
    return pts;
  };
  const weekOf = k => Math.floor(diffD(mon, k) / 7);
  const plan = run(k => { const w = weekOf(k), m = t.semanas[w]?.meta || 0; return w === 0 ? Math.max(0, m - (inp.doneThisWeek || 0)) / daysLeftThisWeek : m / 7; });
  const asIs = run(() => (inp.recentWeekly || 0) / 7);
  const band = CTL_BAND[raceKey(inp.race.type)], tsbBand = M.EVENTS[raceKey(inp.race.type)]?.tsb || [5, 15];
  const end = plan.at(-1), endAsIs = asIs.at(-1);
  return { band, tsbBand, weeks: w0 + 1, now: { ctl, atl }, plan, asIs, metas: t.semanas,
    raceDay: { ctl: end.ctl, tsb: end.ctl - end.atl }, raceDayAsIs: { ctl: endAsIs.ctl, tsb: endAsIs.ctl - endAsIs.atl },
    status: end.ctl >= band[0] ? "ok" : end.ctl >= band[0] * .85 ? "warn" : "bad" };
}

/* ---------------- 2. eficiência aeróbica ---------------- */
/** Corridas aeróbicas (FC até 93% do limiar, 20+ min, 3+ km, pouco desnível): metros por minuto por batimento. */
function efficiency(acts, thr, today) {
  const lthr = (thr && thr.runLthr) || (Motor()?.LTHR_REF ?? 168), since = addK(today, -84);
  const runs = (acts || []).filter(a => a.sport === "run" && a.hr >= 100 && a.mov >= 1200 && a.dist >= 3000 && iso(a.date) >= since && a.hr <= lthr * .93 && (!a.elev || a.elev / (a.dist / 1000) <= 15));
  if (runs.length < 4) return { ok: false, n: runs.length, lthr };
  const refHr = Math.round(median(runs.map(a => a.hr)) / 5) * 5;
  const ef = a => (a.dist / (a.mov / 60)) / a.hr;
  const paceAt = e => 1000 / (e * refHr) * 60; // s/km na FC de referência
  const mon = Motor().util.mondayKey(today), weeks = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addK(mon, -7 * i), xs = runs.filter(a => iso(a.date) >= ws && iso(a.date) < addK(ws, 7));
    weeks.push({ inicio: ws, n: xs.length, pace: xs.length ? paceAt(median(xs.map(ef))) : null, hr: xs.length ? Math.round(avg(xs.map(a => a.hr))) : null });
  }
  const recent = runs.filter(a => iso(a.date) >= addK(today, -28)), before = runs.filter(a => iso(a.date) < addK(today, -28) && iso(a.date) >= addK(today, -84));
  const pNow = recent.length >= 2 ? paceAt(median(recent.map(ef))) : null, pThen = before.length >= 2 ? paceAt(median(before.map(ef))) : null;
  return { ok: true, n: runs.length, refHr, lthr, weeks, paceNow: pNow, paceThen: pThen, delta: pNow && pThen ? pNow - pThen : null };
}

/* ---------------- 3. tempo estimado de prova ---------------- */
function raceTime(inp) {
  const [swimM, bikeKm, runKm] = RACE_DIST[raceKey(inp.raceType)], thr = inp.thr || {}, tt = inp.testes || {}, today = inp.today;
  const recent = sp => (inp.acts || []).filter(a => a.sport === sp && iso(a.date) >= addK(today, -56));
  const legs = {};
  // natação: CSS do teste (+4% em águas abertas com orientação), senão ritmo dos treinos
  if (thr.css) legs.swim = { s: swimM / 100 * thr.css * 1.04, fonte: "teste (ritmo de referência)", conf: 2 };
  else { const xs = recent("swim").filter(a => a.dist >= 400 && a.mov > 0); const d = xs.reduce((t, a) => t + a.dist, 0), m = xs.reduce((t, a) => t + a.mov, 0);
    if (d) legs.swim = { s: swimM * (m / d) * 1.02, fonte: "ritmo dos seus treinos", conf: 1 }; }
  if (legs.swim && tt.swim?.continuo_m && tt.swim.continuo_m < swimM) legs.swim.nota = `hoje você nada ${tt.swim.continuo_m} m sem parar; a prova pede ${fmt(swimM, 0)} m`;
  // bike: teste de 20 min (prova a ~92% da velocidade do teste), senão mediana dos pedais de 40+ min
  if (tt.bike?.kmh) legs.bike = { s: bikeKm / (tt.bike.kmh * .92) * 3600, fonte: "teste de 20 min", conf: 2 };
  else { const xs = recent("bike").filter(a => a.mov >= 2400 && a.dist > 0).map(a => a.dist / 1000 / (a.mov / 3600)).filter(v => v >= 12 && v <= 50);
    if (xs.length) legs.bike = { s: bikeKm / (median(xs) * 1.03) * 3600, fonte: "velocidade dos seus pedais", conf: 1 }; }
  // corrida: pace de limiar do teste (Riegel a partir de 1 h) +4% por vir da bike, senão a melhor projeção dos treinos
  const riegel = (t, d1, d2) => t * Math.pow(d2 / d1, 1.06);
  if (thr.runPace) { const t0 = runKm * thr.runPace; legs.run = { s: t0 * Math.pow(t0 / 3600, .06) * 1.04, fonte: "teste de 20 min", conf: 2 }; }
  else { const xs = recent("run").filter(a => a.dist >= 3000 && a.mov > 0).map(a => riegel(a.mov, a.dist / 1000, runKm));
    if (xs.length) legs.run = { s: Math.min(...xs) * 1.04, fonte: "seus treinos (provavelmente você é mais rápido)", conf: 1 }; }
  const trans = raceKey(inp.raceType) === "olimpico" || raceKey(inp.raceType) === "sprint" ? 240 : raceKey(inp.raceType) === "super_sprint" ? 180 : 420;
  const all = legs.swim && legs.bike && legs.run;
  return { legs, transicoes: trans, total: all ? legs.swim.s + legs.bike.s + legs.run.s + trans : null,
    conf: all ? Math.min(legs.swim.conf, legs.bike.conf, legs.run.conf) : 0, dist: { swimM, bikeKm, runKm },
    faltando: ["swim", "bike", "run"].filter(sp => !legs[sp]) };
}

/* ---------------- 4. distância: maior sessão recente × prova ---------------- */
function gap(acts, raceType, today, weeksLeft) {
  const [swimM, bikeKm, runKm] = RACE_DIST[raceKey(raceType)], since = addK(today, -28);
  const xs = (acts || []).filter(a => iso(a.date) >= since);
  const mx = sp => Math.max(0, ...xs.filter(a => a.sport === sp).map(a => a.dist));
  // alvo de pico do longo (biblioteca do coach): um pouco acima da distância da prova
  const rows = [
    { sport: "swim", nome: "Natação", atual: mx("swim"), prova: swimM, alvo: swimM * 1.2, un: "m", passo: 200 },
    { sport: "bike", nome: "Bike", atual: mx("bike") / 1000, prova: bikeKm, alvo: bikeKm * 1.4, un: "km", passo: 15 },
    { sport: "run", nome: "Corrida", atual: mx("run") / 1000, prova: runKm, alvo: runKm * 1.25, un: "km", passo: 2.5 },
  ];
  for (const r of rows) {
    r.pctProva = r.prova ? clamp(r.atual / r.prova, 0, 2) : 0; r.pctAlvo = clamp(r.atual / r.alvo, 0, 1.5);
    // semanas para chegar ao alvo com a progressão máxima segura (1 de cada 4 é recuperação)
    r.semanasPrecisa = r.atual >= r.alvo ? 0 : Math.ceil((r.alvo - r.atual) / r.passo * 4 / 3);
    r.cabe = weeksLeft == null ? true : r.semanasPrecisa <= Math.max(0, weeksLeft - 3);
  }
  return rows;
}

/* ---------------- 5. risco de lesão ---------------- */
/** loads: [{k:'YYYY-MM-DD', load}] diários. Agudo = 7 dias; crônico = média semanal de 28 dias. */
function risk(loads, acts, today) {
  const by = new Map(); for (const x of loads || []) by.set(x.k, (by.get(x.k) || 0) + x.load);
  const sum = (from, n) => { let s = 0; for (let i = 0; i < n; i++) s += by.get(addK(from, -i)) || 0; return s; };
  const acute = sum(today, 7), chronic = sum(today, 28) / 4;
  const ratio = chronic >= 40 ? acute / chronic : null;
  const runKm = (from, to) => (acts || []).filter(a => a.sport === "run" && iso(a.date) > from && iso(a.date) <= to).reduce((t, a) => t + a.dist / 1000, 0);
  const run7 = runKm(addK(today, -7), today), run21 = runKm(addK(today, -28), addK(today, -7)) / 3;
  const runJump = run21 >= 5 ? (run7 - run21) / run21 : null;
  const status = ratio == null ? "sem_dados" : ratio > 1.5 ? "alto" : ratio > 1.3 ? "atencao" : ratio < .8 ? "baixo" : "ideal";
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio, status, run7, run21, runJump };
}

/* ---------------- 6. recuperação ---------------- */
function recovery(checkins, today) {
  const list = (checkins || []).filter(c => c?.data && c.data <= today);
  const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
  const metric = (key, betterUp) => {
    const days = Array.from({ length: 14 }, (_, i) => addK(today, i - 13)), val = k => num(list.find(c => c.data === k)?.[key]);
    const pts = days.map(k => ({ k, v: val(k) }));
    const recent = list.filter(c => diffD(c.data, today) < 7).map(c => num(c[key])).filter(v => v != null);
    const base = list.filter(c => { const d = diffD(c.data, today); return d >= 7 && d < 60; }).map(c => num(c[key])).filter(v => v != null);
    const r = avg(recent), b = avg(base);
    const delta = r != null && b ? (r - b) / b : null;
    return { pts, recente: r, normal: b, delta, n: recent.length, bom: delta == null ? null : betterUp ? delta >= -.05 : delta <= .05 };
  };
  const out = { hrv: metric("hrv", true), rhr: metric("rhr", false), sono: metric("sono", true) };
  out.temDados = Object.values(out).some(m => m.n >= 3);
  return out;
}

/* ---------------- 7. insights de melhora ---------------- */
function insights(r) {
  const out = [], add = (prio, tipo, titulo, texto, acao) => out.push({ prio, tipo, titulo, texto, acao });
  const k = r.risk, p = r.proj, e = r.eff, rt = r.race, rec = r.rec;
  if (k?.status === "alto") add(100, "alerta", "Carga subiu rápido demais", `Seus últimos 7 dias somam ${k.acute} pts de carga, ${fmt(k.ratio, 1)}× a sua média semanal (${k.chronic}). Acima de 1,5× o risco de lesão sobe muito.`, "Faça os próximos 2–3 dias leves (Z1–Z2) e não compense treinos perdidos.");
  else if (k?.status === "atencao") add(70, "atencao", "Carga acima do habitual", `Semana com ${fmt(k.ratio, 1)}× a sua média recente de carga. Até 1,3× é o ideal.`, "Mantenha os dias fáceis bem fáceis até a semana acabar.");
  if (k?.runJump != null && k.runJump > .3 && k.run7 >= 8) add(85, "atencao", "Corrida subiu muito", `${fmt(k.run7, 1)} km de corrida nos últimos 7 dias, ${Math.round(k.runJump * 100)}% acima da média das 3 semanas anteriores (${fmt(k.run21, 1)} km).`, "Corrida é onde mais acontece lesão: suba no máximo 10% por semana e use a bike para volume extra.");
  if (rec?.hrv?.delta != null && rec.hrv.n >= 3 && rec.hrv.delta <= -.1) add(80, "atencao", "HRV abaixo do seu normal", `Média de 7 dias ${Math.round(rec.hrv.recente)} ms, ${Math.round(-rec.hrv.delta * 100)}% abaixo do seu normal (${Math.round(rec.hrv.normal)} ms).`, "Priorize sono e alivie os treinos fortes até a HRV voltar.");
  if (rec?.sono?.recente != null && rec.sono.n >= 3 && rec.sono.recente < 7) add(60, "atencao", "Sono curto", `Você dormiu ${fmt(rec.sono.recente, 1)} h por noite na média da semana. Quem treina para triatlo rende melhor com 7–9 h.`, "Vá para a cama 30 min mais cedo nos dias de treino forte.");
  if (rec?.rhr?.delta != null && rec.rhr.n >= 3 && rec.rhr.delta >= .08) add(65, "atencao", "FC de repouso subindo", `Média de ${Math.round(rec.rhr.recente)} bpm, acima do seu normal (${Math.round(rec.rhr.normal)} bpm).`, "Sinal de fadiga ou doença chegando: um dia leve extra ajuda.");
  if (p) {
    const [lo, hi] = p.band;
    if (p.raceDay.ctl < lo) add(75, "atencao", "Condicionamento abaixo do ideal no dia da prova", `Seguindo o plano você chega com ${Math.round(p.raceDay.ctl)} de condicionamento; o ideal para a prova é ${lo}–${hi}.`, "O que mais sobe esse número é constância: treine mais dias por semana, mesmo que curto.");
    else add(30, "bom", "No caminho certo para a prova", `Seguindo o plano você chega com ${Math.round(p.raceDay.ctl)} de condicionamento (ideal ${lo}–${hi}) e equilíbrio ${sign(p.raceDay.tsb)} no dia.`, null);
    if (p.raceDayAsIs.ctl < lo && p.raceDay.ctl >= lo) add(55, "atencao", "Do jeito que está, não chega", `Se continuar treinando como nas últimas semanas, chega com ${Math.round(p.raceDayAsIs.ctl)}. O plano leva você a ${Math.round(p.raceDay.ctl)}.`, "Siga as metas semanais do plano: elas sobem aos poucos até a prova.");
  }
  if (e?.ok && e.delta != null) {
    if (e.delta <= -5) add(40, "bom", "Corrida mais eficiente", `Na mesma FC (${e.refHr} bpm), seu pace foi de ${mmss(e.paceThen)} para ${mmss(e.paceNow)}/km. É a base aeróbica funcionando.`, null);
    else if (e.delta >= 8) add(50, "atencao", "Pace caiu na mesma FC", `Na mesma FC (${e.refHr} bpm), seu pace foi de ${mmss(e.paceThen)} para ${mmss(e.paceNow)}/km. Costuma ser fadiga acumulada, calor ou pouco sono.`, "Confira o sono e faça uma semana mais leve se o cansaço continuar.");
  }
  for (const g of r.gap || []) if (!g.cabe && g.atual > 0) add(68, "atencao", `${g.nome}: falta distância`, `Seu maior treino recente foi ${fmt(g.atual, g.un === "m" ? 0 : 1)} ${g.un}; para a prova o longo deve chegar a ~${fmt(g.alvo, g.un === "m" ? 0 : 1)} ${g.un}. Com a progressão segura isso leva ~${g.semanasPrecisa} semanas.`, "Faça o longo dessa modalidade toda semana, subindo aos poucos.");
  if (rt?.faltando?.length || (rt && rt.conf < 2)) {
    const names = { swim: "natação", bike: "bike", run: "corrida" }, missing = (r.testesPendentes || []).map(s => names[s]).filter(Boolean);
    if (missing.length) add(45, "neutro", "Faça os testes de nivelamento", `Falta teste de ${missing.join(", ")}. Com eles, zonas, carga e tempo estimado de prova ficam calculados pelos seus números.`, "Os testes estão em Treinos → Testes; levam 20–30 min cada.");
  }
  if (r.diasTreino14 != null && r.diasTreino14 < 6) add(58, "atencao", "Pouca constância", `Você treinou em ${r.diasTreino14} dos últimos 14 dias.`, "Treinar 5–6 dias por semana, mesmo curto, rende mais que poucos treinos longos.");
  return out.sort((a, b) => b.prio - a.prio);
}

/** Tudo de uma vez. ctx: { today, acts, thr, testes, checkins, race, level, hours, series, recentWeekly, doneThisWeek, loads, testesPendentes } */
function analyze(ctx) {
  const M = Motor(), w0 = ctx.race?.date && M ? M.weeksToRace(ctx.today, ctx.race.date) : null;
  const r = {
    proj: projection(ctx), eff: efficiency(ctx.acts, ctx.thr, ctx.today),
    race: raceTime({ raceType: ctx.race?.type, thr: ctx.thr, testes: ctx.testes, acts: ctx.acts, today: ctx.today }),
    gap: gap(ctx.acts, ctx.race?.type, ctx.today, w0 == null ? null : w0 + 1),
    risk: risk(ctx.loads, ctx.acts, ctx.today), rec: recovery(ctx.checkins, ctx.today),
    testesPendentes: ctx.testesPendentes || [],
    diasTreino14: new Set((ctx.acts || []).filter(a => a.sport !== "other" && iso(a.date) > addK(ctx.today, -14)).map(a => iso(a.date))).size,
  };
  r.insights = insights(r);
  return r;
}

/* ======================= HTML (usa o sistema visual do app) ======================= */
let cssDone = false;
function css() {
  if (cssDone || typeof document === "undefined" || !document.head?.appendChild) return; cssDone = true;
  const s = document.createElement("style"); s.id = "analise-css";
  s.textContent = `.an-chart svg{display:block;width:100%;height:auto}.an-chart .ax{font:500 10px var(--mono);fill:var(--muted)}.an-chart .gl{stroke:var(--line);stroke-width:1}
.an-chart .guide{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3;opacity:0}.an-chart .guide.on{opacity:1}.an-chart .gdot{fill:var(--surface);stroke:var(--ink);stroke-width:2;opacity:0}.an-chart .gdot.on{opacity:1}
.an-l{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.an-band{fill:var(--ok);opacity:.12}.an-race{stroke:var(--ink);stroke-width:1;stroke-dasharray:3 3}
.an-ins{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.an-ins li{padding:10px 12px;border-radius:10px;background:var(--soft);border-left:3px solid var(--c,var(--muted))}
.an-ins b{display:block;font-size:14px}.an-ins p{margin:3px 0 0;font-size:13.5px;line-height:1.45}.an-ins .an-do{color:var(--ink);font-weight:600}.an-ins .an-tag{font:600 10px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.an-legs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}.an-legs div{padding:10px;border-radius:10px;background:var(--soft);border-top:3px solid var(--c)}.an-legs span{display:block;font-size:11px;color:var(--muted)}.an-legs b{font:600 17px var(--mono)}.an-legs em{display:block;font-style:normal;font-size:11px;color:var(--muted);margin-top:2px}
.an-total{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.an-total b{font:700 34px/1 var(--display)}.an-total span{color:var(--muted);font-size:13px}
.an-gap{display:flex;flex-direction:column;gap:12px}.an-gap .an-row{display:grid;grid-template-columns:72px 1fr auto;gap:10px;align-items:center;font-size:13px}.an-track{position:relative;height:10px;border-radius:5px;background:var(--soft)}
.an-track i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--c)}.an-track u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.55}.an-gap small{grid-column:2/4;color:var(--muted);font-size:12px;margin-top:-6px}
.an-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.an-kpis div{padding:10px;border-radius:10px;background:var(--soft)}.an-kpis span{display:block;font-size:11px;color:var(--muted)}.an-kpis b{font:600 18px var(--mono)}.an-kpis em{display:block;font-style:normal;font-size:11.5px;margin-top:2px}
.an-good{color:var(--ok)}.an-bad{color:var(--bad)}.an-warn{color:var(--warn)}.an-st{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13px}.an-st i{width:9px;height:9px;border-radius:50%;background:var(--c)}
.an-sm{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.an-sm>div{min-width:0}.an-sm .an-h{font-size:11px;color:var(--muted)}.an-sm .an-v{font:600 15px var(--mono)}
@media (max-width:380px){.an-legs,.an-kpis,.an-sm{grid-template-columns:1fr}}`;
  document.head.appendChild(s);
}
const card = (title, sub, body) => `<section class="card an"><div class="card-h"><h2>${title}</h2>${sub ? `<span class="note">${sub}</span>` : ""}</div>${body}</section>`;
const ST = { ok: ["var(--ok)", "an-good"], warn: ["var(--warn)", "an-warn"], bad: ["var(--bad)", "an-bad"] };
const TIPO_C = { alerta: "var(--bad)", atencao: "var(--warn)", bom: "var(--ok)", neutro: "var(--swim)" };
const TIPO_T = { alerta: "Alerta", atencao: "Atenção", bom: "Ponto forte", neutro: "Dica" };
const dd = k => noon(k).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const scrub = (h, id, svg, opt) => `<div class="an-chart">${h?.scrubHTML ? h.scrubHTML(id, svg, opt) : svg}</div>`;

function insightsHTML(list, max = 5) {
  if (!list.length) return `<p class="note">Sem pontos de atenção agora. Siga o plano.</p>`;
  return `<ul class="an-ins">${list.slice(0, max).map(i => `<li style="--c:${TIPO_C[i.tipo]}"><span class="an-tag">${TIPO_T[i.tipo]}</span><b>${esc(i.titulo)}</b><p>${esc(i.texto)}</p>${i.acao ? `<p class="an-do">${esc(i.acao)}</p>` : ""}</li>`).join("")}</ul>`;
}

function projectionHTML(p, h) {
  if (!p) return "";
  const W = 340, H = 170, L = 2, R = 30, T = 12, B = 22, iw = W - L - R, ih = H - T - B, n = p.plan.length;
  const max = Math.max(p.band[1] * 1.1, ...p.plan.map(x => x.ctl), ...p.asIs.map(x => x.ctl)) * 1.05;
  const x = i => +(L + (n === 1 ? iw / 2 : i / (n - 1) * iw)).toFixed(1), y = v => +(T + ih - v / max * ih).toFixed(1);
  const line = pts => pts.map((q, i) => `${i ? "L" : "M"}${x(i)},${y(q.ctl)}`).join("");
  const step = max > 80 ? 25 : max > 40 ? 15 : 10, grid = [];
  for (let v = 0; v <= max; v += step) grid.push(`<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${W - 2}" y="${y(v) + 3.5}" text-anchor="end" class="ax">${v}</text>`);
  const months = []; p.plan.forEach((q, i) => { const d = noon(q.k); if (i && d.getDate() <= 7 && i < n - 2) months.push(`<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</text>`); });
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projeção do condicionamento até a prova">
    ${grid.join("")}<rect x="${L}" y="${y(p.band[1])}" width="${iw}" height="${y(p.band[0]) - y(p.band[1])}" class="an-band"/>
    <text x="${L + 4}" y="${y(p.band[1]) + 11}" class="ax">faixa ideal no dia da prova</text>${months.join("")}
    <path d="${line(p.asIs)}" class="an-l" style="stroke:var(--muted);stroke-dasharray:4 4"/><path d="${line(p.plan)}" class="an-l" style="stroke:var(--swim)"/>
    <line x1="${x(n - 1)}" x2="${x(n - 1)}" y1="${T}" y2="${T + ih}" class="an-race"/><circle cx="${x(n - 1)}" cy="${y(p.raceDay.ctl)}" r="4.5" style="fill:var(--swim);stroke:var(--surface);stroke-width:2"/>
    <text x="${x(n - 1) - 6}" y="${y(p.raceDay.ctl) - 8}" text-anchor="end" class="ax" style="fill:var(--ink);font-weight:600">${Math.round(p.raceDay.ctl)} na prova</text>
    <line class="guide" y1="${T}" y2="${T + ih}"/><circle class="gdot" r="5"/></svg>`;
  const chart = scrub(h, "an-proj", svg, { W, n, x, y: i => y(p.plan[i].ctl), tip: i => { const q = p.plan[i], a = p.asIs[i];
    return `<b>${i === n - 1 ? "Dia da prova" : "Semana de " + dd(q.k)}</b><span><i style="background:var(--swim)"></i>Seguindo o plano <em>${fmt(q.ctl, 0)}</em></span><span><i style="background:var(--muted)"></i>Como está <em>${fmt(a.ctl, 0)}</em></span>${p.metas[Math.floor(i)] ? `<span class="tnote">${p.metas[i].fase}${p.metas[i].recuperacao ? " · recuperação" : ""} · meta ${p.metas[i].meta} pts</span>` : ""}`; } });
  const [c, cls] = ST[p.status];
  return card("Até a prova", `${p.weeks} semanas`, `
    <div class="an-kpis"><div><span>Hoje</span><b>${fmt(p.now.ctl, 0)}</b><em>condicionamento</em></div>
      <div><span>No dia da prova</span><b class="${cls}">${fmt(p.raceDay.ctl, 0)}</b><em>ideal ${p.band[0]}–${p.band[1]}</em></div>
      <div><span>Equilíbrio no dia</span><b>${sign(p.raceDay.tsb)}</b><em>alvo ${sign(p.tsbBand[0])} a ${sign(p.tsbBand[1])}</em></div></div>
    ${chart}
    <div class="legend"><span style="--c:var(--swim)">Seguindo o plano</span><span style="--c:var(--muted)">Se continuar como está</span><span style="--c:var(--ok)">Faixa ideal</span></div>
    <p class="note">Projeção do motor: as metas semanais até a prova, com recuperação a cada 4 semanas e polimento. Toque no gráfico para ver cada semana.</p>`);
}

function raceHTML(rt) {
  const legs = [["swim", "Natação", `${fmt(rt.dist.swimM, 0)} m`], ["bike", "Bike", `${rt.dist.bikeKm} km`], ["run", "Corrida", `${fmt(rt.dist.runKm, 1)} km`]];
  const per = (sp, l) => sp === "swim" ? `${mmss(l.s / (rt.dist.swimM / 100))}/100 m` : sp === "bike" ? `${fmt(rt.dist.bikeKm / (l.s / 3600), 1)} km/h` : `${mmss(l.s / rt.dist.runKm)}/km`;
  const notes = legs.map(([sp]) => rt.legs[sp]?.nota).filter(Boolean);
  return card("Tempo estimado de prova", rt.conf === 2 ? "pelos seus testes" : "estimativa", `
    ${rt.total ? `<div class="an-total"><b>${hms(rt.total)}</b><span>com ${Math.round(rt.transicoes / 60)} min de transições</span></div>` : `<p class="note">Faltam dados de ${rt.faltando.map(s => ({ swim: "natação", bike: "bike", run: "corrida" })[s]).join(", ")} para estimar o total.</p>`}
    <div class="an-legs">${legs.map(([sp, n, d]) => { const l = rt.legs[sp]; return `<div style="--c:var(--${sp})"><span>${n} · ${d}</span><b>${l ? hms(l.s) : "—"}</b><em>${l ? `${per(sp, l)} · ${esc(l.fonte)}` : "sem dados"}</em></div>`; }).join("")}</div>
    ${notes.map(x => `<p class="note an-warn">${esc(x)}</p>`).join("")}
    <p class="note">Hoje, se a prova fosse amanhã. Natação em águas abertas um pouco mais lenta que na piscina; corrida ~4% mais lenta por vir da bike. O percurso real (subidas, calor) muda o número.</p>`);
}

function gapHTML(rows, weeksLeft) {
  return card("Distância da prova", "maior treino · 4 semanas", `<div class="an-gap">${rows.map(r => {
    const d = r.un === "m" ? 0 : 1, pctA = Math.min(100, r.atual / r.alvo * 100), mark = Math.min(100, r.prova / r.alvo * 100);
    const msg = r.atual >= r.alvo ? "pronto: já passa da distância da prova" : r.atual >= r.prova ? `já faz a distância; alvo do longo ~${fmt(r.alvo, d)} ${r.un}` : r.atual === 0 ? "nenhum treino nas últimas 4 semanas" : `faltam ${fmt(r.prova - r.atual, d)} ${r.un} para a distância da prova · ~${r.semanasPrecisa} semanas até o alvo${r.cabe ? "" : " (apertado)"}`;
    return `<div class="an-row" style="--c:var(--${r.sport})"><b>${r.nome}</b><div class="an-track" role="img" aria-label="${r.nome}: ${fmt(r.atual, d)} de ${fmt(r.alvo, d)} ${r.un}"><i style="width:${pctA}%"></i><u style="left:${mark}%"></u></div><span class="mono">${fmt(r.atual, d)} ${r.un}</span><small>${msg}</small></div>`; }).join("")}</div>
    <p class="note">A barra vai até o alvo do longo no pico; a marca é a distância da prova.${weeksLeft != null ? ` Faltam ${weeksLeft} semanas.` : ""}</p>`);
}

function effHTML(e, h) {
  if (!e.ok) return card("Eficiência na corrida", "pace na mesma FC", `<p class="note">Aparece com 4+ corridas leves com FC nas últimas 12 semanas (tem ${e.n}). Corra com o relógio medindo a FC.</p>`);
  const ws = e.weeks, pts = ws.map((w, i) => ({ i, v: w.pace })).filter(q => q.v), W = 340, H = 150, L = 2, R = 40, T = 12, B = 22, iw = W - L - R, ih = H - T - B;
  const lo = Math.min(...pts.map(q => q.v)) - 10, hi = Math.max(...pts.map(q => q.v)) + 10;
  const x = i => +(L + i / 11 * iw).toFixed(1), y = v => +(T + (v - lo) / (hi - lo) * ih).toFixed(1); // mais rápido = mais alto
  const path = pts.map((q, k) => `${k ? "L" : "M"}${x(q.i)},${y(q.v)}`).join("");
  const st = hi - lo > 80 ? 30 : hi - lo > 40 ? 15 : 10, tv = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) tv.push(v);
  const ticks = tv.map(v => `<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${W - 2}" y="${y(v) + 3.5}" text-anchor="end" class="ax">${mmss(v)}</text>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pace na FC de ${e.refHr} bpm por semana">${ticks}
    <path d="${path}" class="an-l" style="stroke:var(--run)"/>${pts.map(q => `<circle cx="${x(q.i)}" cy="${y(q.v)}" r="3.2" style="fill:var(--run);stroke:var(--surface);stroke-width:1.5"/>`).join("")}
    <text x="${L}" y="${H - 6}" class="ax">${dd(ws[0].inicio)}</text><text x="${L + iw}" y="${H - 6}" text-anchor="end" class="ax">esta semana</text>
    <line class="guide" y1="${T}" y2="${T + ih}"/><circle class="gdot" r="5"/></svg>`;
  const idx = pts.map(q => q.i);
  const chart = scrub(h, "an-eff", svg, { W, n: idx.length, x: k => x(idx[k]), y: k => y(pts[k].v), tip: k => { const w = ws[idx[k]]; return `<b>Semana de ${dd(w.inicio)}</b><span><i style="background:var(--run)"></i>Pace a ${e.refHr} bpm <em>${mmss(w.pace)}/km</em></span><span class="tnote">${w.n} corrida${w.n > 1 ? "s" : ""} · FC média ${w.hr}</span>`; } });
  const d = e.delta, cls = d == null ? "" : d <= -3 ? "an-good" : d >= 5 ? "an-bad" : "";
  return card("Eficiência na corrida", `pace a ${e.refHr} bpm`, `
    <div class="an-kpis"><div><span>8 semanas atrás</span><b>${e.paceThen ? mmss(e.paceThen) : "—"}</b><em>/km</em></div><div><span>Últimas 4 semanas</span><b>${e.paceNow ? mmss(e.paceNow) : "—"}</b><em>/km</em></div>
      <div><span>Mudança</span><b class="${cls}">${d == null ? "—" : `${d < 0 ? "−" : "+"}${Math.abs(Math.round(d))} s`}</b><em>${d == null ? "" : d < 0 ? "mais rápido" : d > 0 ? "mais lento" : "igual"}</em></div></div>
    ${chart}
    <p class="note">Pace que você faz com a mesma FC (${e.refHr} bpm), só nas corridas leves. Cair o pace na mesma FC = base aeróbica melhorando. Calor, subida e cansaço pioram o número.</p>`);
}

function riskHTML(k) {
  if (k.status === "sem_dados") return "";
  const M = { ideal: ["var(--ok)", "Ideal", "Carga desta semana parecida com a das últimas 4: é assim que se evolui sem lesão."], baixo: ["var(--swim)", "Abaixo do habitual", "Semana mais leve que a sua média. Ótimo se for recuperação; se não, a forma começa a cair."],
    atencao: ["var(--warn)", "Atenção", "Semana acima do habitual. Dias fáceis bem fáceis até ela acabar."], alto: ["var(--bad)", "Alto", "Subida brusca de carga, o principal fator de lesão em amador. Alivie 2–3 dias."] }[k.status];
  const pos = clamp((k.ratio - .5) / 1.3 * 100, 0, 100);
  return card("Risco de lesão", "variação de carga", `
    <div class="an-st" style="--c:${M[0]}"><i></i>${M[1]} · ${fmt(k.ratio, 2)}×</div>
    <div class="an-track" style="margin:12px 0 4px;background:linear-gradient(90deg,var(--swim) 0 ${(.3 / 1.3) * 100}%,var(--ok) 0 ${(.8 / 1.3) * 100}%,var(--warn) 0 ${(1 / 1.3) * 100}%,var(--bad) 0);opacity:.85"><u style="left:${pos}%;width:3px;background:var(--ink);opacity:1"></u></div>
    <div class="legend"><span style="--c:var(--swim)">&lt; 0,8 leve</span><span style="--c:var(--ok)">0,8–1,3 ideal</span><span style="--c:var(--warn)">1,3–1,5</span><span style="--c:var(--bad)">&gt; 1,5</span></div>
    <p>${M[2]}</p>
    <div class="an-kpis"><div><span>Últimos 7 dias</span><b>${k.acute}</b><em>pts de carga</em></div><div><span>Média semanal (4 sem)</span><b>${k.chronic}</b><em>pts de carga</em></div>
      <div><span>Corrida 7 dias</span><b>${fmt(k.run7, 1)} km</b><em>${k.runJump == null ? "" : `${k.runJump >= 0 ? "+" : "−"}${Math.abs(Math.round(k.runJump * 100))}% vs média`}</em></div></div>`);
}

function recoveryHTML(rec, h) {
  if (!rec.temDados) return card("Recuperação", "14 dias", `<p class="note">Faça o check-in de manhã (sono, HRV, FC de repouso) por alguns dias para ver sua tendência e o seu normal.</p>`);
  const spark = (m, id, color, un, fx) => {
    const pts = m.pts.map((q, i) => ({ i, v: q.v, k: q.k })).filter(q => q.v != null);
    if (pts.length < 2) return `<div><div class="an-h">${id}</div><div class="an-v">${m.recente != null ? fx(m.recente) + un : "—"}</div><p class="note">poucos dados</p></div>`;
    const W = 110, H = 44, P = 4, vals = pts.map(q => q.v).concat(m.normal ?? []), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = i => +(P + i / 13 * (W - 2 * P)).toFixed(1), y = v => +(H - P - (v - lo) / span * (H - 2 * P)).toFixed(1);
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${id} nos últimos 14 dias">${m.normal != null ? `<line x1="${P}" x2="${W - P}" y1="${y(m.normal)}" y2="${y(m.normal)}" class="gl" style="stroke-dasharray:3 3"/>` : ""}
      <path d="${pts.map((q, k) => `${k ? "L" : "M"}${x(q.i)},${y(q.v)}`).join("")}" class="an-l" style="stroke:${color};stroke-width:1.8"/><circle cx="${x(pts.at(-1).i)}" cy="${y(pts.at(-1).v)}" r="3" style="fill:${color}"/>
      <line class="guide" y1="${P}" y2="${H - P}"/><circle class="gdot" r="3.5"/></svg>`;
    const d = m.delta, cls = m.bom == null ? "" : m.bom ? "an-good" : "an-warn";
    return `<div><div class="an-h">${id}</div><div class="an-v">${fx(m.recente)}${un}</div><div class="note ${cls}">${d == null ? "sem normal ainda" : `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}% vs seu normal`}</div>
      ${scrub(h, "an-rec-" + id, svg, { W, n: pts.length, x: k => x(pts[k].i), y: k => y(pts[k].v), tip: k => `<b>${dd(pts[k].k)}</b><span><em>${fx(pts[k].v)}${un}</em></span>${m.normal != null ? `<span class="tnote">normal ${fx(m.normal)}${un}</span>` : ""}` })}</div>`;
  };
  return card("Recuperação", "média de 7 dias × seu normal", `<div class="an-sm">
    ${spark(rec.hrv, "HRV", "var(--swim)", " ms", v => Math.round(v))}${spark(rec.rhr, "FC repouso", "var(--run)", " bpm", v => Math.round(v))}${spark(rec.sono, "Sono", "var(--bike)", " h", v => fmt(v, 1))}</div>
    <p class="note">Linha tracejada = seu normal (média de 8 a 60 dias atrás). HRV e sono abaixo, ou FC de repouso acima do normal por vários dias, pedem treino mais leve.</p>`);
}

/** Cards da aba Análise. h = { scrubHTML } do app (opcional). */
function cardsHTML(r, h) {
  css();
  const w = r.proj ? r.proj.weeks : null;
  return [card("Insights de melhora", "o que mais muda o seu resultado agora", insightsHTML(r.insights, 6)), projectionHTML(r.proj, h), raceHTML(r.race), gapHTML(r.gap, w), effHTML(r.eff, h), riskHTML(r.risk), recoveryHTML(r.rec, h)].join("");
}
/** Card curto para a aba Hoje: os 2 pontos mais importantes + o tempo estimado. */
function summaryHTML(r, goAttr) {
  css();
  // na aba Hoje os testes já têm o próprio aviso: aqui só alertas e atenções
  const top = r.insights.filter(i => i.tipo === "alerta" || i.tipo === "atencao").slice(0, 2), good = r.insights.find(i => i.tipo === "bom");
  const list = top.length ? top : good ? [good] : [];
  return card("Insights de melhora", r.race.total ? `prova hoje ≈ ${hms(r.race.total)}` : "", `${insightsHTML(list, 2)}${goAttr ? `<button type="button" class="btn ghost sm" ${goAttr} style="margin-top:10px">Ver análise completa</button>` : ""}`);
}

const Analise = { RACE_DIST, CTL_BAND, projection, efficiency, raceTime, gap, risk, recovery, insights, analyze, cardsHTML, summaryHTML, insightsHTML, util: { hms, mmss } };
root.Analise = Analise;
if (typeof module !== "undefined" && module.exports) module.exports = Analise;
})(typeof window !== "undefined" ? window : globalThis);
