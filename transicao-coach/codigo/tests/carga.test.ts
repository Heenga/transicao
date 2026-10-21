import { describe, it, expect } from "vitest";
import { defaultCtlCap, activityTss, loadSeries, dailyTss, weeklyTargets, mondayOf, weekAdherence, plannedWorkoutTss, structureMinutes } from "../src/carga.js";
import { cssFromTest, ftpFrom20min, hrZones } from "../src/zonas.js";
import type { Workout } from "../src/schema/plano.js";

describe("zonas", () => {
  it("CSS do exemplo do material (400 em 6:40, 200 em 3:00) = 1:50/100m", () => {
    expect(cssFromTest(400, 180)).toBe(110);
  });
  it("FTP = 95% do teste de 20 min", () => expect(ftpFrom20min(250)).toBe(238));
  it("Z2 de FC = 81–90% da LTHR", () => {
    const z = hrZones(170).zones[1];
    expect([z.hrLow, z.hrHigh]).toEqual([138, 153]);
  });
});

describe("TSS", () => {
  it("1 h no FTP = 100 TSS", () => {
    expect(activityTss({ date: "2026-10-01", sport: "bike", movingTimeS: 3600, normalizedWatts: 200 }, { ftp: 200 }).tss).toBe(100);
  });
  it("corrida no ritmo de limiar por 1 h = 100", () => {
    const r = activityTss({ date: "2026-10-01", sport: "run", movingTimeS: 3600, distanceM: 12000 }, { runThresholdSecKm: 300 });
    expect(r).toEqual({ tss: 100, method: "pace" });
  });
  it("natação usa IF³", () => {
    // 1 h a CSS+10 s (IF = 110/120)
    const r = activityTss({ date: "2026-10-01", sport: "swim", movingTimeS: 3600, distanceM: 3000 }, { cssSec100m: 110 });
    expect(r.method).toBe("swim_pace");
    expect(r.tss).toBeCloseTo(100 * (110 / 120) ** 3, 0);
  });
  it("cai para Relative Effort e depois para estimativa", () => {
    expect(activityTss({ date: "x", sport: "run", movingTimeS: 1800, sufferScore: 33 }, {}).method).toBe("suffer_score");
    expect(activityTss({ date: "x", sport: "strength", movingTimeS: 3600 }, {}).tss).toBe(35);
  });
});

describe("CTL/ATL/TSB", () => {
  it("100 TSS/dia por 42 dias leva CTL a ~63% do alvo", () => {
    const m = new Map<string, number>();
    const s = loadSeries(m, "2026-01-01", "2026-02-11", { ctl: 0, atl: 0 });
    expect(s.length).toBe(42);
    const filled = new Map(s.map((p) => [p.date, 100]));
    const s2 = loadSeries(filled, "2026-01-01", "2026-02-11");
    expect(s2.at(-1)!.ctl).toBeGreaterThan(62);
    expect(s2.at(-1)!.ctl).toBeLessThan(65);
    expect(s2.at(-1)!.atl).toBeGreaterThan(99);
  });
  it("dailyTss soma treinos do mesmo dia", () => {
    expect(dailyTss([{ date: "a", tss: 40 }, { date: "a", tss: 60 }]).get("a")).toBe(100);
  });
});

describe("metas semanais", () => {
  const t = weeklyTargets({
    today: "2026-10-21", eventDate: "2027-05-30", eventType: "olimpico",
    level: "intermediate", currentCtl: 40, currentAtl: 45,
  });
  it("começa na próxima segunda e termina na semana da prova", () => {
    expect(t.weeks[0].startDate).toBe("2026-10-26");
    expect(t.weeks.at(-1)!.startDate).toBe(mondayOf("2027-05-30"));
    expect(t.weeks.length).toBe(31);
  });
  it("tem recuperação a cada 4ª semana nas fases de carga e polimento no fim", () => {
    const rec = t.weeks.filter((w) => w.recovery).map((w) => w.week);
    expect(rec.slice(0, 3)).toEqual([4, 8, 12]);
    expect(t.weeks.at(-1)!.phase).toBe("Polimento");
    expect(t.weeks.at(-2)!.phase).toBe("Polimento");
  });
  it("teto padrão do olímpico intermediário = 59 (7,5 h × 55 ÷ 7)", () => {
    expect(defaultCtlCap("olimpico", "intermediate")).toBe(59);
  });
  it("nunca sobe mais que 10% por semana", () => {
    let prev = 7 * 40;
    for (const w of t.weeks.filter((x) => !x.recovery && x.phase !== "Polimento")) {
      expect(w.tss).toBeLessThanOrEqual(Math.round(prev * 1.1) + 1);
      prev = Math.max(prev, w.tss);
    }
  });
  it("respeita o teto de CTL e chega descansado", () => {
    expect(Math.max(...t.weeks.map((w) => w.ctlEnd))).toBeLessThanOrEqual(59.5);
    expect(t.projectedRaceDay.tsb).toBeGreaterThan(0);
  });
  it("avisa quando falta tempo", () => {
    const short = weeklyTargets({ today: "2026-10-21", eventDate: "2026-12-20", eventType: "70.3", level: "beginner", currentCtl: 20, currentAtl: 20 });
    expect(short.warnings[0]).toMatch(/mínimo recomendado/);
  });
});

describe("treino planejado", () => {
  const w: Workout = {
    id: "w1-tue-bike", sport: "bike", type: "threshold", name: "Limiar", description: "",
    durationMinutes: 60, completed: false,
    structure: {
      warmup: [{ type: "warmup", duration: { unit: "minutes", value: 15 }, intensity: { unit: "percent_ftp", value: 60 } }],
      main: [{ type: "interval_set", repeats: 3, steps: [
        { type: "work", duration: { unit: "minutes", value: 8 }, intensity: { unit: "percent_ftp", value: 100 } },
        { type: "recovery", duration: { unit: "minutes", value: 4 }, intensity: { unit: "percent_ftp", value: 55 } },
      ] }],
      cooldown: [{ type: "cooldown", duration: { unit: "minutes", value: 9 }, intensity: { unit: "percent_ftp", value: 55 } }],
    },
  };
  it("soma dos passos = 60 min", () => expect(structureMinutes(w)).toBe(60));
  it("TSS pelos passos", () => expect(plannedWorkoutTss(w)).toBeGreaterThan(55));
});

describe("aderência", () => {
  it("decide repetir carga entre 70 e 90%", () => {
    expect(weekAdherence({ sessionsPlanned: 8, sessionsDone: 6, tssPlanned: 400, tssDone: 330 }).decision).toBe("repetir_carga");
  });
});
