export type ChargingSpeed = "NORMAL" | "FAST" | "ULTRA_FAST";

const CHARGING_SPEED_MAX_DURATION_MS: Record<ChargingSpeed, number> = {
  NORMAL: 7 * 60 * 1000,
  FAST: 5 * 60 * 1000,
  ULTRA_FAST: 3 * 60 * 1000,
};

export const CHARGING_DURATION_MS = CHARGING_SPEED_MAX_DURATION_MS.NORMAL;
export const CHARGING_PERCENT_INTERVAL_MS = 30 * 1000;

export const resolveChargingSpeed = (value: unknown): ChargingSpeed => {
  if (value === "FAST" || value === "ULTRA_FAST" || value === "NORMAL") {
    return value;
  }

  return "NORMAL";
};

export const getMaxChargingDurationMs = (chargingSpeed: unknown) => {
  return CHARGING_SPEED_MAX_DURATION_MS[resolveChargingSpeed(chargingSpeed)];
};
