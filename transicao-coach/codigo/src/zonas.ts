/**
 * Zonas de treino a partir dos testes de campo.
 * Fórmulas e faixas de conhecimento/02-zonas-e-testes.md.
 */
import type { HeartRateZones, PowerZones, SwimZones, PaceZones } from "./schema/plano.js";

const HR_ZONES: [string, string, number, number][] = [
  ["1", "Recuperação", 0, 81],
  ["2", "Aeróbico", 81, 90],
  ["3", "Tempo", 90, 94],
  ["4", "Sublimiar", 94, 100],
  ["5a", "Limiar", 100, 103],
  ["5b", "VO2máx", 103, 107],
  ["5c", "Anaeróbico", 107, 120],
];

const POWER_ZONES: [string, string, number, number][] = [
  ["1", "Recuperação", 0, 56],
  ["2", "Aeróbico", 56, 76],
  ["3", "Tempo", 76, 91],
  ["4", "Sublimiar", 91, 100],
  ["5a", "Limiar", 100, 106],
  ["5b", "VO2máx", 106, 121],
  ["5c", "Anaeróbico", 121, 150],
];

/** Zonas de FC pelo LTHR (Friel, 7 zonas). Limite superior exclusivo. */
export function hrZones(lthr: number): HeartRateZones {
  return {
    lthr,
    zones: HR_ZONES.map(([z, name, lo, hi], i) => ({
      zone: i + 1,
      name: `Z${z} ${name}`,
      percentLow: lo,
      percentHigh: hi,
      hrLow: Math.round((lthr * lo) / 100),
      hrHigh: Math.round((lthr * hi) / 100),
    })),
  };
}

/** Zonas de potência pelo FTP. */
export function powerZones(ftp: number): PowerZones {
  return {
    ftp,
    zones: POWER_ZONES.map(([z, name, lo, hi], i) => ({
      zone: i + 1,
      name: `Z${z} ${name}`,
      percentLow: lo,
      percentHigh: hi,
      wattsLow: Math.round((ftp * lo) / 100),
      wattsHigh: Math.round((ftp * hi) / 100),
    })),
  };
}

export function formatPace(seconds: number, unit = "/100m"): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${unit}`;
}

/** Zonas de natação pelo CSS (segundos por 100 m). Usa o meio de cada faixa. */
export function swimZones(cssSeconds: number): SwimZones {
  const z: [number, string, number][] = [
    [1, "Recuperação", 17],
    [2, "Aeróbico", 10],
    [3, "Tempo", 4],
    [4, "Limiar", 0],
    [5, "VO2máx", -4],
  ];
  return {
    css: formatPace(cssSeconds),
    cssSeconds,
    zones: z.map(([zone, name, off]) => ({
      zone,
      name,
      paceOffset: off,
      pace: formatPace(cssSeconds + off),
    })),
  };
}

/** Zonas de ritmo de corrida (Daniels) pelo ritmo de limiar (s/km). */
export function runPaceZones(thresholdSecKm: number): PaceZones {
  const z: [string, string, number][] = [
    ["E", "Leve", 60],
    ["M", "Maratona", 20],
    ["T", "Limiar", 0],
    ["I", "Intervalado", -17],
    ["R", "Repetição", -30],
  ];
  return {
    thresholdPace: formatPace(thresholdSecKm, "/km"),
    thresholdPaceSeconds: thresholdSecKm,
    zones: z.map(([zone, name, off]) => ({
      zone,
      name,
      pace: formatPace(thresholdSecKm + off, "/km"),
      paceSeconds: thresholdSecKm + off,
    })),
  };
}

// --- Testes de campo -------------------------------------------------------

/** FTP a partir do teste de 20 min. */
export const ftpFrom20min = (avgWatts: number) => Math.round(avgWatts * 0.95);
/** FTP a partir do teste 2× 8 min. */
export const ftpFrom2x8 = (avgWatts: number) => Math.round(avgWatts * 0.9);
/** CSS (s/100 m) a partir dos tiros de 400 m e 200 m (tempos em segundos). */
export const cssFromTest = (t400: number, t200: number) => Math.round(((t400 - t200) / 200) * 100 * 10) / 10;
