import { describe, it, expect } from "vitest";
import { readiness } from "../src/prontidao.js";

describe("prontidão", () => {
  it("verde sem alertas", () => {
    expect(readiness({ hrvLast7: [70, 71, 69], hrvBaseline: 70, sleepHoursLast: [7.5, 7.2] }).status).toBe("verde");
  });
  it("amarelo com HRV 10%+ abaixo", () => {
    const r = readiness({ hrvLast7: [60, 61, 62], hrvBaseline: 70 });
    expect(r.status).toBe("amarelo");
    expect(r.alerts[0]).toMatch(/HRV/);
  });
  it("vermelho com HRV baixa + sono curto", () => {
    expect(readiness({ hrvLast7: [60], hrvBaseline: 70, sleepHoursLast: [5, 5.5] }).status).toBe("vermelho");
  });
  it("vermelho com TSB < -30", () => expect(readiness({ tsb: -35 }).status).toBe("vermelho"));
  it("doença tem prioridade", () => expect(readiness({ reportedIllness: true, tsb: 10 }).status).toBe("doenca"));
});
