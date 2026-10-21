import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePlan } from "../src/validar.js";
import type { TrainingPlan } from "../src/schema/plano.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../exemplos/${f}`, import.meta.url), "utf8")) as TrainingPlan;

describe("validador", () => {
  for (const f of ["olympic-tri-plan.json", "sprint-tri-plan.json"]) {
    it(`roda nos exemplos do claude-coach: ${f}`, () => {
      const r = validatePlan(load(f));
      console.log(f, "erros:", r.errors.length, "avisos:", r.warnings.length);
      for (const e of r.errors.slice(0, 8)) console.log("  E", e.path, "→", e.message);
      expect(Array.isArray(r.errors)).toBe(true);
    });
  }

  it("pega o mesmo esporte em dias seguidos e duração que não fecha", () => {
    const plan = load("sprint-tri-plan.json");
    const wk = plan.weeks[0];
    const d0 = wk.days[0], d1 = wk.days[1];
    d0.workouts = [{ id: "a", sport: "run", type: "endurance", name: "Rodagem", description: "", durationMinutes: 40, completed: false }];
    d1.workouts = [{ id: "b", sport: "run", type: "tempo", name: "Tempo", description: "", durationMinutes: 50, completed: false,
      structure: { main: [{ type: "work", duration: { unit: "minutes", value: 30 }, intensity: { unit: "rpe", value: 7 } }] } }];
    const r = validatePlan(plan);
    expect(r.errors.some((e) => /dias seguidos/.test(e.message))).toBe(true);
    expect(r.errors.some((e) => /Passos somam 30 min/.test(e.message))).toBe(true);
    expect(r.feedbackForModel).toMatch(/Corrija/);
  });

  it("brick no sábado + longo de corrida no domingo é permitido", () => {
    const plan = load("sprint-tri-plan.json");
    const wk = plan.weeks[0];
    const sat = wk.days.find((d) => d.dayOfWeek === "Saturday")!;
    const sun = wk.days.find((d) => d.dayOfWeek === "Sunday")!;
    const fri = wk.days.find((d) => d.dayOfWeek === "Friday")!;
    fri.workouts = [];
    sat.workouts = [
      { id: "s1", sport: "bike", type: "endurance", name: "Bike", description: "", durationMinutes: 60, completed: false },
      { id: "s2", sport: "run", type: "brick", name: "Transição", description: "", durationMinutes: 15, completed: false },
    ];
    sun.workouts = [{ id: "s3", sport: "run", type: "long", name: "Longo", description: "", durationMinutes: 60, completed: false }];
    const mon = plan.weeks[1]?.days[0];
    if (mon) mon.workouts = [];
    const r = validatePlan(plan);
    expect(r.errors.filter((e) => /run em dias seguidos \(\d{4}-\d\d-\d\d e /.test(e.message) && e.path.includes(sun.date))).toEqual([]);
  });
});
