import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const M = createRequire(import.meta.url)("../public/motor.js");

const RACE = "2027-05-30", TYPE = "olimpico";

test("sem limiares a carga é igual à do app antigo (esforço, depois FC ÷ 168, depois média da modalidade)", () => {
  const h1 = { sport: "run", mov: 3600 };
  assert.equal(Math.round(M.activityLoad({ ...h1, rpe: 6 }).load), Math.round((0.45 + 0.055 * 6) ** 2 * 100));
  assert.equal(Math.round(M.activityLoad({ ...h1, hr: 150 }).load), Math.round((150 / 168) ** 2 * 100));
  assert.equal(Math.round(M.activityLoad(h1).load), Math.round(0.78 ** 2 * 100));
  assert.equal(M.activityLoad({ sport: "run", mov: 0 }).load, 0);
});

test("com teste, usa o limiar do atleta", () => {
  const t = M.thresholdsFromTests({ run: { dist_km: 4, hr: 180 }, bike: { watts: 200, hr: 170 }, swim: { t400: 440, t200: 200 } });
  assert.equal(t.runPace, Math.round(300 * 1.03));
  assert.equal(t.runLthr, Math.round(180 * .97));
  assert.equal(t.ftp, 190);
  assert.equal(t.css, 120);
  // 10 km em 1 h no pace de limiar ≈ 100 de carga
  const run = M.activityLoad({ sport: "run", mov: 3600, dist: 3600 / t.runPace * 1000 }, t);
  assert.equal(run.method, "pace"); assert.ok(Math.abs(run.load - 100) < 1);
  assert.equal(M.activityLoad({ sport: "bike", mov: 3600, watts: 190 }, t).method, "potência");
  assert.equal(M.activityLoad({ sport: "bike", mov: 3600, hr: 140 }, { runLthr: 170 }).method, "FC de limiar");
  // teste caminhando não vira limiar de pace
  assert.equal(M.thresholdsFromTests({ run: { dist_km: 2, caminhou: true } }).runPace, undefined);
});

test("fases ancoradas na prova: iguais para todos e com recuperação 3:1", () => {
  const ph = w => M.weekPhase(w, TYPE);
  assert.equal(ph(0).fase, "Polimento"); assert.ok(ph(0).semanaDaProva);
  assert.equal(ph(1).fase, "Polimento");
  assert.equal(ph(2).fase, "Específico"); assert.equal(ph(4).fase, "Específico");
  assert.equal(ph(5).fase, "Construção"); assert.equal(ph(14).fase, "Construção"); assert.equal(ph(15).fase, "Base");
  const rec = Array.from({ length: 31 }, (_, w) => w).filter(w => ph(w).recuperacao);
  assert.deepEqual(rec, [8, 12, 16, 20, 24, 28]);
  // a semana desta quarta (21/10/2026) é a mesma para qualquer atleta
  assert.equal(M.weeksToRace("2026-10-21", RACE), M.weeksToRace("2026-10-25", RACE));
});

test("meta semanal progride até o específico em vez de encostar no teto cedo", () => {
  const r = M.weekTargets({ today: "2026-10-21", raceDate: RACE, raceType: TYPE, level: "intermediate", hours: 8, recentWeekly: 250, ctl: 35, weeks: 32 });
  const metas = r.semanas.filter(w => !w.recuperacao && (w.fase === "Base" || w.fase === "Construção")).map(w => w.meta);
  assert.ok(metas[0] > 250 && metas[0] <= 275, "1ª semana sobe no máximo 10%");
  for (let i = 1; i < metas.length; i++) assert.ok(metas[i] >= metas[i - 1]);
  const firstTop = metas.findIndex(m => m === Math.max(...metas));
  assert.ok(firstTop > metas.length * 0.7, `pico só no fim da construção (semana ${firstTop} de ${metas.length})`);
  const rec = r.semanas.find(w => w.recuperacao), before = r.semanas[r.semanas.indexOf(rec) - 1];
  assert.ok(Math.abs(rec.meta - before.meta * .6) <= 1);
  const last = r.semanas.at(-1); assert.ok(last.meta < metas.at(-1) * .5, "semana da prova bem leve");
  assert.ok(Math.max(...r.semanas.map(w => w.horas)) <= 8);
});

test("sem histórico começa com ~metade das horas, e nunca passa das horas disponíveis", () => {
  const r = M.weekTargets({ today: "2026-10-21", raceDate: RACE, raceType: TYPE, level: "beginner", hours: 5, recentWeekly: 0, ctl: 0 });
  assert.ok(Math.abs(r.semanas[0].horas - 2.7) < 0.4);
  const big = M.weekTargets({ today: "2026-10-21", raceDate: RACE, raceType: TYPE, level: "advanced", hours: 4, recentWeekly: 600, ctl: 80 });
  assert.ok(big.semanas[0].meta <= 240);
});

test("prontidão a partir do check-in do app", () => {
  const d = n => M.util.addDaysKey("2026-10-21", -n);
  const base = Array.from({ length: 30 }, (_, i) => ({ data: d(i + 1), hrv: 70, rhr: 50, sono: 7.5 }));
  assert.equal(M.readiness(base, { today: "2026-10-21" }).status, "verde");
  const lowHrv = [...base.slice(7), ...Array.from({ length: 7 }, (_, i) => ({ data: d(i), hrv: 58, rhr: 50, sono: 7.5 }))];
  const y = M.readiness(lowHrv, { today: "2026-10-21" });
  assert.equal(y.status, "amarelo"); assert.match(y.alerts[0], /HRV/);
  assert.equal(M.readiness([...base, { data: d(0), sono: 5.5, cans: 5, qual: 2 }], { today: "2026-10-21" }).status, "vermelho");
  assert.equal(M.readiness(base, { today: "2026-10-21", tsb: -35 }).status, "vermelho");
  assert.equal(M.readiness([{ data: d(0), obs: "acordei com febre" }], { today: "2026-10-21" }).status, "doenca");
  assert.equal(M.readiness([], { today: "2026-10-21" }).status, "verde");
});

const run = (titulo, min, zona, etapas, extra = {}) => ({ sport: "run", titulo, min, zona, pace: "6:00/km", etapas, ...extra });
const ok = [{ fase: "Aquecimento", min: 10, desc: "Z1" }, { fase: "Principal", min: 30, desc: "Z2" }, { fase: "Desaquecimento", min: 5, desc: "solto" }];

test("validador: duração, qualidade, 48 h, modalidades mantidas e meta", () => {
  const good = M.validateDays([{ data: "2026-10-22", sessoes: [run("Corrida leve", 45, "Z2", ok)] }], {});
  assert.ok(good.ok, good.feedback);

  const sum = M.validateDays([{ data: "2026-10-22", sessoes: [run("Corrida leve", 60, "Z2", ok)] }], {});
  assert.ok(!sum.ok); assert.match(sum.feedback, /somam 45 min/);

  const tiros = run("Corrida: tiros no limiar", 50, "Z4", [{ fase: "Aquecimento", min: 15, desc: "Z1" }, { fase: "Principal", min: 25, desc: "5x4 min Z4" }, { fase: "Desaquecimento", min: 10, desc: "Z1" }]);
  const twoDays = M.validateDays([{ data: "2026-10-22", sessoes: [tiros] }, { data: "2026-10-23", sessoes: [tiros] }], {});
  assert.match(twoDays.feedback, /48 h/);
  const prev = M.validateDays([{ data: "2026-10-22", sessoes: [tiros] }], { diaAnterior: { data: "2026-10-21", sessoes: [tiros] } });
  assert.match(prev.feedback, /48 h/);

  const keep = M.validateDays([{ data: "2026-10-22", sessoes: [{ sport: "swim", titulo: "Natação", min: 45, etapas: [{ fase: "x", min: 45, desc: "Z2" }] }] }], { manterModalidades: { "2026-10-22": ["run"], "2026-10-23": ["bike"] } });
  assert.equal(keep.errors.length, 2);

  const meta = M.validateDays(["2026-10-22", "2026-10-23", "2026-10-24"].map(data => ({ data, sessoes: [run("Corrida leve", 45, "Z2", ok)] })), { meta: 600, cargaFeita: 100 });
  assert.match(meta.feedback, /meta restante de 500/);

  const longo = M.validateDays([{ data: "2026-10-25", sessoes: [run("Longão", 45, "Z2", ok, { dist: "12 km" })] }], { maiorCorridaKm: 7 });
  assert.match(longo.feedback, /máx\. \+3 km/);
});

test("brick curto depois da bike não conta como corrida em dias seguidos", () => {
  const bike = { sport: "bike", titulo: "Bike longa", min: 120, zona: "Z2", etapas: [{ fase: "Principal", min: 120, desc: "Z2" }] };
  const brickRun = run("Transição: corrida", 20, "Z2", [{ fase: "Principal", min: 20, desc: "Z2" }]);
  const r = M.validateDays([{ data: "2026-10-24", sessoes: [bike, brickRun] }, { data: "2026-10-25", sessoes: [run("Longão", 45, "Z2", ok)] }], {});
  assert.ok(!r.warnings.some(w => /run em dias seguidos/.test(w)), r.warnings.join("\n"));
});

test("carga planejada sobe com a intensidade", () => {
  const easy = M.sessionLoad(run("leve", 60, "Z2", [{ fase: "Principal", min: 60, desc: "Z2" }]));
  const hard = M.sessionLoad(run("forte", 60, "Z4", [{ fase: "Aquecimento", min: 15, desc: "Z1" }, { fase: "Principal", min: 30, desc: "Z4" }, { fase: "Desaquecimento", min: 15, desc: "Z1" }]));
  assert.ok(Math.abs(easy - 52) < 1); assert.ok(hard > easy);
  assert.equal(Math.round(M.sessionLoad({ sport: "strength", min: 60 })), 35);
});
