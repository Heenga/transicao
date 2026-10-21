import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Decoder, Stream } from "@garmin/fitsdk";
import { exportWorkout, exportPlanCalendar, getAvailableFormats } from "../src/export/index.js";
import type { TrainingPlan, Workout } from "../src/schema/plano.js";

const plan = JSON.parse(readFileSync(new URL("../../exemplos/olympic-tri-plan.json", import.meta.url), "utf8")) as TrainingPlan;
const all: Workout[] = plan.weeks.flatMap((w) => w.days.flatMap((d) => d.workouts));

const bikeStructured: Workout = {
  id: "w5-tue-bike", sport: "bike", type: "threshold", name: "Limiar 3x8", description: "", durationMinutes: 60, completed: false,
  structure: {
    warmup: [{ type: "warmup", duration: { unit: "minutes", value: 15 }, intensity: { unit: "percent_ftp", value: 60 } }],
    main: [{ type: "interval_set", repeats: 3, steps: [
      { type: "work", duration: { unit: "minutes", value: 8 }, intensity: { unit: "percent_ftp", value: 100 } },
      { type: "recovery", duration: { unit: "minutes", value: 4 }, intensity: { unit: "percent_ftp", value: 55 } },
    ] }],
    cooldown: [{ type: "cooldown", duration: { unit: "minutes", value: 9 }, intensity: { unit: "percent_ftp", value: 55 } }],
  },
};

describe("exportação", () => {
  it("gera .fit, .zwo e .erg para um treino de bike", async () => {
    const bike = bikeStructured;
    expect(getAvailableFormats(bike)).toEqual(["fit", "zwo", "mrc", "erg"]);
    const fit = await exportWorkout(bike, "fit");
    expect(fit.content).toBeInstanceOf(Uint8Array);
    const { messages, errors } = new Decoder(Stream.fromByteArray(fit.content as Uint8Array)).read();
    expect(errors).toEqual([]);
    const st = messages.workoutStepMesgs;
    // aquecimento, trabalho, recuperação, repetição (3x a partir do passo 1), desaquecimento
    expect(st.length).toBe(5);
    expect(st[3].durationType).toBe("repeatUntilStepsCmplt");
    expect(st[3].targetValue ?? st[3].repeatSteps).toBe(3);
    expect(st[1].targetType).toBe("power");
    expect(String((await exportWorkout(bike, "zwo")).content)).toContain("<workout_file>");
    expect(String((await exportWorkout(bike, "erg", { bike: { ftp: 210 } })).content)).toContain("FTP = 210");
  });
  it("gera .fit para treinos sem structure (natação, corrida, bike do exemplo)", async () => {
    for (const sport of ["run", "bike"] as const) {
      const w = all.find((x) => x.sport === sport)!;
      expect(((await exportWorkout(w, "fit")).content as Uint8Array).length).toBeGreaterThan(50);
    }
  });
  it("gera .fit para natação", async () => {
    const swim = all.find((w) => w.sport === "swim")!;
    const fit = await exportWorkout(swim, "fit");
    expect((fit.content as Uint8Array).length).toBeGreaterThan(50);
  });
  it("calendário em português", () => {
    const ics = String(exportPlanCalendar(plan).content);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toMatch(/Natação|Bike|Corrida/);
  });
});
