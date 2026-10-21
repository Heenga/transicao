/**
 * FIT (Garmin) Workout Export
 *
 * Generates Garmin FIT workout files that can be uploaded to Garmin Connect.
 * Uses the official @garmin/fitsdk package for binary FIT encoding.
 *
 * How to import to Garmin:
 * - Upload to Garmin Connect (connect.garmin.com) -> Training -> Workouts -> Import
 * - The workout will sync to compatible Garmin devices
 */

import type {
  Workout,
  Sport,
  StructuredWorkout,
  WorkoutStep,
  IntervalSet,
} from "../schema/plano.js";
import type { Settings } from "./index.js";
import { Encoder, Profile } from "@garmin/fitsdk";

/**
 * Check if the FIT SDK is available at runtime
 * Always returns true since the SDK is now bundled
 */
export async function isFitSdkAvailable(): Promise<boolean> {
  return true;
}

/**
 * Check if a sport is supported by FIT export
 */
export function isFitSupported(sport: Sport): boolean {
  // FIT supports most sports, excluding rest and race-specific
  return sport !== "rest" && sport !== "race";
}

/**
 * Map our sport types to FIT sport enum values
 */
function getFitSport(sport: Sport): string {
  switch (sport) {
    case "swim":
      return "swimming";
    case "bike":
      return "cycling";
    case "run":
      return "running";
    case "strength":
      return "training";
    case "brick":
      return "multisport";
    default:
      return "generic";
  }
}

/**
 * Map our sport types to FIT sub_sport enum values
 */
function getFitSubSport(sport: Sport): string {
  switch (sport) {
    case "swim":
      return "lapSwimming";
    case "bike":
      return "road";
    case "run":
      return "road";
    case "strength":
      return "strengthTraining";
    case "brick":
      return "triathlon";
    default:
      return "generic";
  }
}

/**
 * Get workout step intensity/duration type based on step type
 */
function getStepIntensity(stepType: string): string {
  switch (stepType) {
    case "warmup":
      return "warmup";
    case "cooldown":
      return "cooldown";
    case "rest":
      return "rest";
    case "recovery":
      return "recovery";
    case "work":
      return "active";
    default:
      return "active";
  }
}

/**
 * Convert duration to FIT workout step duration
 */
function getDurationValue(value: number, unit: string): number {
  switch (unit) {
    case "seconds":
      return value * 1000; // FIT uses milliseconds
    case "minutes":
      return value * 60 * 1000;
    case "hours":
      return value * 3600 * 1000;
    case "meters":
      return value * 100; // FIT uses centimeters
    case "kilometers":
      return value * 100000;
    case "miles":
      return value * 160934; // cm per mile
    default:
      return value * 1000;
  }
}

/**
 * Get duration type for FIT
 */
function getDurationType(unit: string): string {
  switch (unit) {
    case "seconds":
    case "minutes":
    case "hours":
      return "time";
    case "meters":
    case "kilometers":
    case "miles":
      return "distance";
    default:
      return "time";
  }
}

/**
 * Generate workout steps from structured workout
 *
 * Transição: reescrito. O original usava nomes de enum em snake_case
 * ("heart_rate", "repeat_until_steps_cmplt") que o @garmin/fitsdk rejeita e
 * inseria o passo de repetição antes dos filhos. No FIT o passo de repetição
 * vem DEPOIS dos filhos: durationValue = índice do primeiro filho,
 * targetValue = número de repetições.
 */
function generateStepsFromStructure(structure: StructuredWorkout): {
  steps: any[];
  totalSteps: number;
} {
  const steps: any[] = [];

  const addStep = (step: WorkoutStep) => {
    const unit = step.duration?.unit ?? "minutes";
    const fitStep: any = {
      messageIndex: steps.length,
      intensity: getStepIntensity(step.type),
      durationType: getDurationType(unit),
      durationValue: Math.round(getDurationValue(step.duration?.value ?? 0, unit)),
      targetType: "open",
      targetValue: 0,
    };
    if (step.name) fitStep.workoutStepName = step.name.slice(0, 15);
    if (step.notes) fitStep.notes = step.notes.slice(0, 50);

    const i = step.intensity;
    if (i) {
      const v = i.value ?? 0;
      switch (i.unit) {
        case "percent_ftp":
          // 0–1000 = % do FTP no FIT
          fitStep.targetType = "power";
          fitStep.customTargetValueLow = Math.round(i.valueLow ?? v - 3);
          fitStep.customTargetValueHigh = Math.round(i.valueHigh ?? v + 3);
          break;
        case "hr_zone":
          // targetValue 1–5 = zona de FC configurada no relógio
          fitStep.targetType = "heartRate";
          fitStep.targetValue = Math.min(5, Math.max(1, Math.round(v)));
          break;
        default:
          // percent_lthr, pace_zone, css_offset, rpe: sem alvo nativo equivalente no FIT → alvo aberto
          break;
      }
    }

    if (step.cadence) {
      fitStep.secondaryTargetType = "cadence";
      fitStep.secondaryCustomTargetValueLow = step.cadence.low;
      fitStep.secondaryCustomTargetValueHigh = step.cadence.high;
    }

    steps.push(fitStep);
  };

  const addIntervalSet = (set: IntervalSet) => {
    const first = steps.length;
    for (const child of set.steps) addStep(child);
    steps.push({
      messageIndex: steps.length,
      durationType: "repeatUntilStepsCmplt",
      durationValue: first,
      targetType: "open",
      targetValue: set.repeats,
    });
  };

  for (const step of structure.warmup ?? []) addStep(step);
  for (const item of structure.main) {
    if ("repeats" in item) addIntervalSet(item as IntervalSet);
    else addStep(item as WorkoutStep);
  }
  for (const step of structure.cooldown ?? []) addStep(step);

  return { steps, totalSteps: steps.length };
}

/**
 * Generate simple workout steps when no structure is provided
 */
function generateSimpleSteps(workout: Workout): { steps: any[]; totalSteps: number } {
  const steps: any[] = [];
  const totalMinutes = workout.durationMinutes || 60;

  // Warmup (10% of total, 5-15 min)
  const warmupMinutes = Math.min(15, Math.max(5, Math.round(totalMinutes * 0.1)));
  steps.push({
    messageIndex: 0,
    workoutStepName: "Warm Up",
    intensity: "warmup",
    durationType: "time",
    durationValue: warmupMinutes * 60 * 1000,
    targetType: "open",
  });

  // Main (80% of total)
  const cooldownMinutes = Math.min(10, Math.max(5, Math.round(totalMinutes * 0.1)));
  const mainMinutes = totalMinutes - warmupMinutes - cooldownMinutes;

  let mainIntensity = "active";
  if (workout.type === "recovery") mainIntensity = "recovery";
  else if (workout.type === "rest") mainIntensity = "rest";
  else if (workout.type === "intervals" || workout.type === "vo2max") mainIntensity = "interval";

  steps.push({
    messageIndex: 1,
    workoutStepName: "Main Set",
    intensity: mainIntensity,
    durationType: "time",
    durationValue: mainMinutes * 60 * 1000,
    targetType: "open",
    notes: workout.description || "",
  });

  // Cooldown (10% of total, 5-10 min)
  steps.push({
    messageIndex: 2,
    workoutStepName: "Cool Down",
    intensity: "cooldown",
    durationType: "time",
    durationValue: cooldownMinutes * 60 * 1000,
    targetType: "open",
  });

  return { steps, totalSteps: 3 };
}

/**
 * Generate a complete FIT workout file
 */
export async function generateFit(workout: Workout, _settings: Settings): Promise<Uint8Array> {
  if (!isFitSupported(workout.sport)) {
    throw new Error(`FIT export not supported for ${workout.sport} workouts`);
  }

  const encoder = new Encoder();

  // File ID message (required)
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "workout",
    manufacturer: "development",
    product: 1,
    serialNumber: Math.floor(Math.random() * 1000000),
    timeCreated: new Date(),
  });

  // Generate steps
  const { steps, totalSteps } = workout.structure
    ? generateStepsFromStructure(workout.structure)
    : generateSimpleSteps(workout);

  // Workout message
  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    workoutName: workout.name,
    sport: getFitSport(workout.sport),
    subSport: getFitSubSport(workout.sport),
    numValidSteps: totalSteps,
  });

  // Write workout steps
  for (const step of steps) {
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, step);
  }

  // Finalize and return
  return encoder.close();
}
