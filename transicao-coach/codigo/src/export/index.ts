/**
 * Exportação de treinos (adaptado do claude-coach, MIT).
 *
 * Diferença em relação ao original: aqui as funções devolvem o conteúdo
 * (string/Uint8Array) em vez de disparar download no navegador, para funcionar
 * tanto no backend (Node) quanto no front.
 *
 * - FIT (Garmin)  → todos os esportes exceto descanso/força
 * - ZWO (Zwift)   → bike e corrida
 * - MRC/ERG       → bike (rolo)
 * - ICS           → plano inteiro como calendário
 */
import type { Workout, TrainingPlan } from "../schema/plano.js";
import { generateZwo, isZwoSupported } from "./zwo.js";
import { generateFit, isFitSupported } from "./fit.js";
import { generateMrc, generateErg, isErgSupported } from "./erg.js";
import { generateIcs } from "./ics.js";

/** Só o que os exportadores realmente usam (FTP para o .erg em watts). */
export interface Settings {
  bike?: { ftp?: number };
}

export type ExportFormat = "zwo" | "fit" | "mrc" | "erg";

export interface ExportedFile {
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
}

export function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

export function getAvailableFormats(workout: Workout): ExportFormat[] {
  const f: ExportFormat[] = [];
  if (isFitSupported(workout.sport)) f.push("fit");
  if (isZwoSupported(workout.sport)) f.push("zwo");
  if (isErgSupported(workout.sport)) f.push("mrc", "erg");
  return f;
}

export async function exportWorkout(
  workout: Workout,
  format: ExportFormat,
  settings: Settings = {}
): Promise<ExportedFile> {
  const base = sanitizeFilename(workout.name);
  switch (format) {
    case "fit":
      if (!isFitSupported(workout.sport)) throw new Error(`FIT não suporta ${workout.sport}`);
      return {
        filename: `${base}.fit`,
        mimeType: "application/vnd.ant.fit",
        content: await generateFit(workout, settings),
      };
    case "zwo":
      if (!isZwoSupported(workout.sport)) throw new Error("Zwift só aceita bike e corrida");
      return { filename: `${base}.zwo`, mimeType: "application/xml", content: generateZwo(workout, settings) };
    case "mrc":
      if (!isErgSupported(workout.sport)) throw new Error("MRC só aceita bike");
      return { filename: `${base}.mrc`, mimeType: "text/plain", content: generateMrc(workout, settings) };
    case "erg":
      if (!isErgSupported(workout.sport)) throw new Error("ERG só aceita bike");
      return { filename: `${base}.erg`, mimeType: "text/plain", content: generateErg(workout, settings) };
  }
}

export function exportPlanCalendar(plan: TrainingPlan): ExportedFile {
  return {
    filename: `${sanitizeFilename(plan.meta.event)}_treinos.ics`,
    mimeType: "text/calendar",
    content: generateIcs(plan),
  };
}

export { isZwoSupported, isFitSupported, isErgSupported, generateIcs };
