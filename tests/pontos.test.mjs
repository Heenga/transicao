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

test("regras básicas: 10 por treino de triatlo, 5 por outro; do 4º treino do dia em diante, 5", () => {
  const days = P.daily([act(TODAY, "run", 60), act(TODAY, "bike", 60), act(TODAY, "strength", 30)], RANK);
  assert.equal(days[TODAY].p, 10 + 10 + 5);
  assert.equal(days[TODAY].n, 3);
  const d2 = P.daily([act(TODAY, "strength", 30, { h: "06:00" }), act(TODAY, "other", 40, { h: "08:00" }), act(TODAY, "run", 20, { h: "12:00" }), act(TODAY, "run", 20, { h: "18:00" })], RANK);
  assert.equal(d2[TODAY].p, 10 + 10 + 5 + 5, "2 corridas e 1 de 5 cheios; o 4º vale 5");
  const d3 = P.daily([1, 2, 3, 4, 5].map(i => act(TODAY, "run", 20, { h: `0${i + 4}:00` })), RANK);
  assert.equal(d3[TODAY].p, 3 * 10 + 2 * 5, "5 corridas: 3 × 10 + 2 × 5");
  assert.equal(P.daily([act(TODAY, "brick", 90)], RANK)[TODAY].p, 10, "transição é triatlo");
  assert.equal(P.daily([act(TODAY, "run", 300)], RANK)[TODAY].p, 10, "duração não muda o valor");
});

test("treino curto conta (sem tempo mínimo); caminhada ('outros') vale 5", () => {
  const days = P.daily([act(TODAY, "swim", 3), act("2026-10-20", "other", 50)], RANK);
  assert.equal(days[TODAY].p, 10, "200 m de natação em 3 min valem como qualquer treino");
  assert.equal(days["2026-10-20"].p, 5);
  const dia = P.daily([act(TODAY, "bike", 40, { h: "11:37" }), act(TODAY, "swim", 3, { h: "18:49" })], RANK)[TODAY];
  assert.equal(dia.p, 20, "2 treinos no dia: pontua os 2"); assert.equal(dia.n, 2);
  assert.equal(P.daily([act(TODAY, "strength", 0, { src: "manual", id: "m9" })], RANK)[TODAY].p, 5, "registro manual sem minutos conta");
});

test("treino curto logo depois de outro não é duplicata; a mesma atividade em duas fontes é", () => {
  const curtos = [act(TODAY, "swim", 5, { h: "19:00" }), act(TODAY, "swim", 5, { h: "19:06" })];
  assert.equal(P.scoringActs(curtos, RANK).length, 2, "o 2º começou depois do 1º acabar");
  const duas = [act(TODAY, "bike", 40, { h: "17:36" }), act(TODAY, "bike", 35, { h: "17:37" })];
  assert.equal(P.scoringActs(duas, RANK).length, 1, "Garmin + Zwift do mesmo treino");
  const semTempo = [act(TODAY, "strength", 50), act(TODAY, "strength", 0, { src: "manual", id: "m8" })];
  assert.equal(P.scoringActs(semTempo, RANK).length, 1, "manual sem minutos que repete o sincronizado");
});

test("bônus das 3 modalidades: uma vez por semana, no dia da 3ª", () => {
  const days = P.daily([act("2026-10-19", "swim", 40), act("2026-10-20", "bike", 60), act("2026-10-21", "run", 30), act("2026-10-21", "swim", 30),
    act("2026-10-26", "brick", 60), act("2026-10-27", "swim", 30)], RANK);
  assert.ok(!days["2026-10-19"].tri && !days["2026-10-20"].tri && days["2026-10-21"].tri);
  assert.equal(days["2026-10-21"].p, 10 + 10 + 20);
  assert.ok(days["2026-10-27"].tri, "brick conta como bike e corrida");
});

test("treino manual que repete o sincronizado não conta em dobro", () => {
  const xs = [act(TODAY, "run", 45), act(TODAY, "run", 50, { src: "manual", id: "m1" }), act(TODAY, "swim", 30, { src: "manual", id: "m2" })];
  assert.equal(P.scoringActs(xs, RANK).length, 2);
});

test("distâncias da semana: natação curta soma e duplicata não perde a distância", () => {
  const days = P.daily([
    act("2026-10-27", "swim", 7.5, { h: "19:26", dist: 450 }), act("2026-10-30", "swim", 3, { h: "18:49", dist: 200 }),
    act("2026-10-28", "bike", 40, { h: "17:36", dist: 0 }), act("2026-10-28", "bike", 35, { h: "17:37", dist: 13242 }),
    act("2026-10-29", "bike", 40, { h: "17:00", dist: 0 }), act("2026-10-29", "bike", 40, { h: "17:01", dist: 20000, src: "manual", id: "m7" }),
    act("2026-10-30", "bike", 40, { h: "11:37", dist: 17079 }), act("2026-10-31", "run", 28, { h: "10:18", dist: 5008 })], "2026-10-14");
  const w = P.periods(days, "2026-10-31", "2026-10-14").semana;
  assert.equal(w.swim_m, 650); assert.equal(w.bike_km, 50.3); assert.equal(w.run_km, 5); assert.equal(w.sessions, 6);
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
  assert.equal(ps.dia.points, 10); assert.equal(ps.semana.points, 20); assert.equal(ps.periodo.points, 30);
  assert.equal(ps.mes.points, 30);
  assert.equal(P.periodStartKey("mes", "2026-11-03", RANK), "2026-11-01");
  assert.equal(P.periodStartKey("semana", "2026-10-15", RANK), "2026-10-14");
});

test("placar recalculado no dia em que é visto (sem número velho)", () => {
  const days = P.daily([act("2026-10-20", "run", 60), act("2026-10-21", "bike", 60)], RANK);
  const doc = { nick: "Cassini", days, forma: 20, updatedAt: at("2026-10-21", "20:00") };
  const hoje = P.view(doc, "2026-10-21", RANK), amanha = P.view(doc, "2026-10-22", RANK), semanaQueVem = P.view(doc, "2026-10-26", RANK);
  assert.equal(hoje.periods.dia.points, 10); assert.equal(amanha.periods.dia.points, 0);
  assert.equal(amanha.periods.semana.points, 20); assert.equal(semanaQueVem.periods.semana.points, 0);
  assert.equal(semanaQueVem.points, 0); assert.equal(semanaQueVem.week.hours, 0);
  assert.equal(semanaQueVem.periods.periodo.points, 20);
  assert.equal(P.view({ nick: "antigo" }, TODAY, RANK), null);
});

test("sequências", () => {
  const xs = [act("2026-10-19", "run", 30), act("2026-10-20", "run", 30)];
  for (let i = 0; i < 4; i++) xs.push(act(P.util.addK("2026-10-12", i), "bike", 30));
  const days = P.daily(xs, "2026-10-01");
  assert.deepEqual(P.streaks(days, TODAY), { streakDays: 2, streakWeeks: 1 }, "hoje ainda sem treino: conta até ontem");
});

test("evolução: condicionamento do histórico inteiro, início do período recalculado no dia visto", () => {
  // série de 2026-10-13 a 2026-10-21: 30 → 38
  const formaSerie = { ini: "2026-10-13", v: [30, 31, 32, 33, 34, 35, 36, 37, 38] };
  const doc = { nick: "Cassini", days: {}, forma: 38, formaSerie };
  const v = P.view(doc, "2026-10-21", RANK);
  assert.equal(v.forma, 38);
  assert.equal(v.periods.semana.forma_ini, 35, "véspera da segunda 19/10");
  assert.equal(v.periods.periodo.forma_ini, 30, "véspera do início do ranking: não é zero");
  assert.equal(v.periods.mes.forma_ini, 30, "mês começa antes do ranking: usa o início do ranking");
  const depois = P.view(doc, "2026-10-28", RANK); // sem treino desde 21/10: cai e a semana nova começa do valor de domingo 25
  assert.ok(depois.forma < 38);
  assert.ok(Math.abs(depois.periods.semana.forma_ini - P.formaAt(formaSerie, "2026-10-25")) < 1e-9);
  assert.equal(P.formaAt(null, "2026-10-21"), null);
});

test("resumo gravado pela regra antiga é convertido para a regra atual", () => {
  const old = { "2026-10-19": { p: 99, n: 2, ms: 40, mb: 60, mr: 0, mx: 0, ds: 0, db: 0, dr: 0 },
    "2026-10-20": { p: 99, n: 2, ms: 0, mb: 0, mr: 30, mx: 45, ds: 0, db: 0, dr: 0, tri: 1 },
    "2026-10-21": { p: 99, n: 5, ms: 0, mb: 0, mr: 100, mx: 0, ds: 0, db: 0, dr: 0 } };
  const up = P.upgradeDays(old);
  assert.equal(up["2026-10-19"].p, 20, "natação + bike");
  assert.equal(up["2026-10-20"].p, 10 + 5 + 20, "corrida + força + bônus das 3 modalidades");
  assert.equal(up["2026-10-21"].p, 3 * 10 + 2 * 5, "5 treinos de triatlo");
  const v = P.view({ nick: "x", since: RANK, rules: 2, days: old }, TODAY, RANK);
  assert.equal(v.points, 20 + 35 + 40);
  assert.ok(v.convertido && v.rules === 3);
  assert.equal(P.view({ since: RANK, rules: 3, days: old }, TODAY, RANK).points, 99 * 3, "regra atual não é mexida");
});
