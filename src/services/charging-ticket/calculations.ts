import {
  CHARGING_DURATION_MS,
  type ChargingSpeed,
  getMaxChargingDurationMs,
} from "./constants";
import { clampBatteryPercent } from "./battery";

const calculateChargingProgressPercent = (
  startedAt: Date | null | undefined,
  nowMs = Date.now(),
  durationMs = CHARGING_DURATION_MS
) => {
  if (!startedAt) {
    return 0;
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 100;
  }

  const elapsedMs = nowMs - startedAt.getTime();
  if (elapsedMs <= 0) {
    return 0;
  }

  const percent = (elapsedMs / durationMs) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

const calculateEstimatedCompletionAt = (
  startedAt: Date | null | undefined,
  durationMs = CHARGING_DURATION_MS
) => {
  if (!startedAt) {
    return null;
  }

  const startedAtMs = startedAt.getTime();
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  return new Date(startedAtMs + durationMs);
};

const appendChargingEstimate = (
  ticketSnapshot: Record<string, unknown>,
  startedAt: Date | null | undefined,
  durationMs = CHARGING_DURATION_MS
) => {
  const estimatedCompletionAt = calculateEstimatedCompletionAt(
    startedAt,
    durationMs
  );

  if (!estimatedCompletionAt) {
    return ticketSnapshot;
  }

  return {
    ...ticketSnapshot,
    estimatedCompletionAt,
  };
};

const calculateChargingDurationMs = (
  batteryPercent: number | null | undefined,
  chargingSpeed?: ChargingSpeed | null,
  targetBatteryPercent?: number | null
) => {
  const maxDurationMs = getMaxChargingDurationMs(chargingSpeed);

  if (typeof batteryPercent !== "number" || !Number.isFinite(batteryPercent)) {
    return maxDurationMs;
  }

  const normalizedPercent = clampBatteryPercent(batteryPercent);
  const normalizedTarget =
    typeof targetBatteryPercent === "number" &&
    Number.isFinite(targetBatteryPercent)
      ? clampBatteryPercent(targetBatteryPercent)
      : 100;

  const remainingPercent = Math.max(0, normalizedTarget - normalizedPercent);
  return Math.max(0, Math.round((remainingPercent / 100) * maxDurationMs));
};

export {
  appendChargingEstimate,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  calculateEstimatedCompletionAt,
};
