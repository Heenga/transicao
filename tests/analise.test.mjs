import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
globalThis.Motor = req("../public/motor.js");
const A = req("../public/analise.js");

const TODAY = "2026-10-21", RACE = { date: "2027-05-30", type: "olimpico" };
const add = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const act = (k, sport, dist, mov, hr, extra = {}) => ({ id: k + sport, date: k + "T07:00:00.000Z", sport, dist, mov, hr, ...extra });

test("projeção: seguir o plano chega mais alto que manter como está, e termina no dia da prova", () => {
  const p = A.projection({ today: TODAY, race: RACE, level: "intermediate", hours: 8, recentWeekly: 250, doneThisWeek: 80, series: [{ d: new Date(TODAY + "T00:00:00"), ctl: 35, atl: 38 }] });
  assert.ok(p.raceDay.ctl > p.raceDayAsIs.ctl);
  assert.equal(p.plan.at(-1).k, RACE.date);
  assert.ok(p.raceDay.tsb > 0, "polimento deixa o atleta descansado no dia");
  assert.deepEqual(p.band, [45, 70]);
  assert.equal(A.projection({ today: TODAY, race: { date: "2026-01-01" } }), null);
});

test("eficiência: mesmo FC com pace melhor aparece como ganho", () => {
  const acts = [];
  for (let i = 0; i < 10; i++) { const k = add(TODAY, -80 + i * 3); acts.push(act(k, "run", 7000, 7000 / 1000 * 400, 145)); } // 6:40/km há 2 meses
  for (let i = 0; i < 6; i++) { const k = add(TODAY, -25 + i * 4); acts.push(act(k, "run", 7000, 7000 / 1000 * 370, 145)); } // 6:10/km agora
  acts.push(act(add(TODAY, -3), "run", 5000, 1500, 175)); // tiro forte: fica de fora
  const e = A.efficiency(acts, { runLthr: 175 }, TODAY);
  assert.ok(e.ok); assert.equal(e.refHr, 145);
  assert.ok(Math.abs(e.paceNow - 370) < 1 && Math.abs(e.paceThen - 400) < 1);
  assert.ok(e.delta < -25);
  assert.equal(A.efficiency(acts.slice(0, 2), {}, TODAY).ok, false);
});

test("tempo de prova pelos testes e pelos treinos", () => {
  const t = A.raceTime({ raceType: "olimpico", thr: { css: 120, runPace: 300 }, testes: { bike: { kmh: 30 } }, acts: [], today: TODAY });
  assert.ok(Math.abs(t.legs.swim.s - 15 * 120 * 1.04) < 1);
  assert.ok(Math.abs(t.legs.bike.s - 40 / 27.6 * 3600) < 1);
  // 10 km a 5:00/km de limiar: prova de ~50 min sai um pouco mais rápida que o pace de 1 h (Riegel), +4% por vir da bike
  assert.ok(t.legs.run.s > 3000 && t.legs.run.s < 3000 * 1.04);
  assert.equal(t.conf, 2); assert.ok(t.total > 2.8 * 3600 && t.total < 3.0 * 3600); // 31 + 87 + 51 + 4 min ≈ 2h53
  const t2 = A.raceTime({ raceType: "olimpico", thr: {}, testes: {}, acts: [act(add(TODAY, -5), "run", 5000, 1800, 150)], today: TODAY });
  assert.ok(t2.legs.run && !t2.total); assert.deepEqual(t2.faltando, ["swim", "bike"]);
});

test("distância: quanto falta e se cabe até a prova", () => {
  const g = A.gap([act(add(TODAY, -3), "run", 6000, 2400, 150), act(add(TODAY, -2), "bike", 30000, 3600, 130)], "olimpico", TODAY, 32);
  const run = g.find(r => r.sport === "run");
  assert.equal(run.atual, 6); assert.equal(run.alvo, 12.5); assert.ok(run.cabe);
  assert.equal(g.find(r => r.sport === "swim").atual, 0);
  assert.equal(A.gap([act(add(TODAY, -3), "run", 3000, 1200, 150)], "olimpico", TODAY, 4).find(r => r.sport === "run").cabe, false);
});

test("risco de lesão: semana muito acima da média é alerta", () => {
  const loads = []; for (let i = 27; i >= 7; i--) loads.push({ k: add(TODAY, -i), load: 40 });
  for (let i = 6; i >= 0; i--) loads.push({ k: add(TODAY, -i), load: 90 });
  const r = A.risk(loads, [], TODAY);
  assert.ok(r.ratio > 1.5); assert.equal(r.status, "alto");
  const steady = A.risk(Array.from({ length: 28 }, (_, i) => ({ k: add(TODAY, -i), load: 40 })), [], TODAY);
  assert.equal(steady.status, "ideal");
  assert.equal(A.risk([], [], TODAY).status, "sem_dados");
});

test("recuperação e insights priorizados", () => {
  const ck = Array.from({ length: 40 }, (_, i) => ({ data: add(TODAY, -i), hrv: i < 7 ? 55 : 70, sono: i < 7 ? 6.2 : 7.5, rhr: 50 }));
  const rec = A.recovery(ck, TODAY);
  assert.ok(rec.hrv.delta < -.15); assert.equal(rec.hrv.bom, false); assert.equal(rec.rhr.bom, true);
  const loads = []; for (let i = 27; i >= 0; i--) loads.push({ k: add(TODAY, -i), load: i < 7 ? 90 : 40 });
  const r = A.analyze({ today: TODAY, acts: [], thr: {}, testes: {}, checkins: ck, race: RACE, level: "intermediate", hours: 8, series: [{ d: new Date(TODAY + "T00:00:00"), ctl: 30, atl: 40 }], recentWeekly: 200, doneThisWeek: 0, loads, testesPendentes: ["run", "swim", "bike"] });
  assert.equal(r.insights[0].tipo, "alerta"); // carga subiu rápido demais vem primeiro
  assert.ok(r.insights.some(i => /HRV/.test(i.titulo)));
  assert.ok(r.insights.some(i => /testes/.test(i.titulo)));
  const html = A.cardsHTML(r, null);
  for (const t of ["Insights de melhora", "Até a prova", "Tempo estimado de prova", "Distância da prova", "Risco de lesão", "Recuperação"]) assert.ok(html.includes(t), t);
  assert.ok(A.summaryHTML(r, 'data-go="coach"').includes("Ver análise completa"));
});
