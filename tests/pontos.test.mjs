process.env.TZ = "America/Sao_Paulo";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../public/pontos.js");

const RANK = "2026-10-14", TODAY = "2026-10-21"; // quarta
// horário de Brasília → instante real (UTC−3)
const at = (k, hhmm = "07:00") => new Date(`${k}T${hhmm}:00-03:00`).toISOString();
let seq = 0;
const act = (k, sport, min, extra = {}) => ({ id: String(++seq), date: at(k, extra.h), sport, mov: min * 60, dist: extra.dist || 0, src: extra.src || "strava", ...extra });

test("regras básicas: 10/h + 5 por treino (máx. 2/dia)", () => {
  const days = P.daily([act(TODAY, "run", 60), act(TODAY, "bike", 60), act(TODAY, "strength", 30)], RANK);
  // 2,5 h → 25 pts + 2 treinos × 5 (o 3º treino do dia não ganha os 5) = 35
  assert.equal(days[TODAY].p, 35);
  assert.equal(days[TODAY].n, 3);
});

test("treino curto, 'outros' e relógio esquecido ligado", () => {
  const days = P.daily([act(TODAY, "run", 5), act(TODAY, "other", 120), act("2026-10-20", "bike", 9 * 60)], RANK);
  assert.equal(days[TODAY], undefined, "menos de 10 min e 'outros' não contam");
  assert.equal(days["2026-10-20"].p, 50 + 5, "no máximo 5 h por treino");
});

test("bônus das 3 modalidades: uma vez por semana, no dia da 3ª", () => {
  const days = P.daily([act("2026-10-19", "swim", 40), act("2026-10-20", "bike", 60), act("2026-10-21", "run", 30), act("2026-10-21", "swim", 30),
    act("2026-10-26", "brick", 60), act("2026-10-27", "swim", 30)], RANK);
  assert.ok(!days["2026-10-19"].tri && !days["2026-10-20"].tri && days["2026-10-21"].tri);
  assert.equal(days["2026-10-21"].p, Math.round(1 * 10 + 2 * 5 + 20));
  assert.ok(days["2026-10-27"].tri, "brick conta como bike e corrida");
});

test("treino manual que repete o sincronizado não conta em dobro", () => {
  const xs = [act(TODAY, "run", 45), act(TODAY, "run", 50, { src: "manual", id: "m1" }), act(TODAY, "swim", 30, { src: "manual", id: "m2" })];
  assert.equal(P.scoringActs(xs, RANK).length, 2);
});

test("madrugada fica no dia certo e segunda cedo na semana certa", () => {
  const days = P.daily([act("2026-10-19", "run", 40, { h: "01:30" }), act("2026-10-18", "run", 40, { h: "23:30" })], RANK);
  assert.ok(days["2026-10-19"] && days["2026-10-18"]);
  const ps = P.periods(days, TODAY, RANK);
  assert.equal(ps.semana.sessions, 1, "a corrida de domingo 23:30 é da semana passada");
  assert.equal(ps.periodo.sessions, 2);
});

test("períodos somam os dias e nunca começam antes da competição", () => {
  const days = P.daily([act("2026-10-10", "run", 60), act("2026-10-15", "run", 60), act("2026-10-20", "bike", 60), act(TODAY, "swim", 60)], RANK);
  assert.equal(days["2026-10-10"], undefined, "antes do início da competição não conta");
  const ps = P.periods(days, TODAY, RANK);
  assert.equal(ps.dia.points, 15); assert.equal(ps.semana.points, 30); assert.equal(ps.periodo.points, 45);
  assert.equal(ps.mes.points, 45);
  assert.equal(P.periodStartKey("mes", "2026-11-03", RANK), "2026-11-01");
  assert.equal(P.periodStartKey("semana", "2026-10-15", RANK), "2026-10-14");
});

test("placar recalculado no dia em que é visto (sem número velho)", () => {
  const days = P.daily([act("2026-10-20", "run", 60), act("2026-10-21", "bike", 60)], RANK);
  const doc = { nick: "Cassini", days, forma: 20, updatedAt: at("2026-10-21", "20:00") };
  const hoje = P.view(doc, "2026-10-21", RANK), amanha = P.view(doc, "2026-10-22", RANK), semanaQueVem = P.view(doc, "2026-10-26", RANK);
  assert.equal(hoje.periods.dia.points, 15); assert.equal(amanha.periods.dia.points, 0);
  assert.equal(amanha.periods.semana.points, 30); assert.equal(semanaQueVem.periods.semana.points, 0);
  assert.equal(semanaQueVem.points, 0); assert.equal(semanaQueVem.week.hours, 0);
  assert.equal(semanaQueVem.periods.periodo.points, 30);
  assert.equal(P.view({ nick: "antigo" }, TODAY, RANK), null);
});

test("sequências", () => {
  const xs = [act("2026-10-19", "run", 30), act("2026-10-20", "run", 30)];
  for (let i = 0; i < 4; i++) xs.push(act(P.util.addK("2026-10-12", i), "bike", 30));
  const days = P.daily(xs, "2026-10-01");
  assert.deepEqual(P.streaks(days, TODAY), { streakDays: 2, streakWeeks: 1 }, "hoje ainda sem treino: conta até ontem");
});
