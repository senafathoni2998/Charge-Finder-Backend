const clampBatteryPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

const resolveBatteryCapacity = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
};

const resolveTicketKwh = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
};

const resolveBatteryPercentFromVehicleInfo = (vehicleInfo: unknown) => {
  if (!vehicleInfo || typeof vehicleInfo !== "object") {
    return null;
  }

  const rawPercent = (vehicleInfo as { batteryPercent?: unknown })
    .batteryPercent;
  if (typeof rawPercent !== "number" || !Number.isFinite(rawPercent)) {
    return null;
  }

  return clampBatteryPercent(rawPercent);
};

const resolveBatteryCapacityFromInfo = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return resolveBatteryCapacity(
    (value as { batteryCapacity?: unknown }).batteryCapacity
  );
};

const resolveStartingBatteryPercent = (
  snapshot: Record<string, unknown>,
  vehicleInfo?: Record<string, unknown> | null
) => {
  const rawStartingPercent = (snapshot as { startingBatteryPercent?: unknown })
    .startingBatteryPercent;

  if (
    typeof rawStartingPercent === "number" &&
    Number.isFinite(rawStartingPercent)
  ) {
    return clampBatteryPercent(rawStartingPercent);
  }

  return resolveBatteryPercentFromVehicleInfo(
    vehicleInfo ?? (snapshot as { vehicleInfo?: unknown }).vehicleInfo
  );
};

const resolveTargetBatteryPercent = (
  snapshot: Record<string, unknown>,
  startingBatteryPercent: number | null,
  vehicleInfo?: Record<string, unknown> | null
) => {
  if (startingBatteryPercent === null) {
    return null;
  }

  const rawTarget = (snapshot as { targetBatteryPercent?: unknown })
    .targetBatteryPercent;
  if (typeof rawTarget === "number" && Number.isFinite(rawTarget)) {
    return clampBatteryPercent(rawTarget);
  }

  const ticketKwh = resolveTicketKwh(
    (snapshot as { ticketKwh?: unknown }).ticketKwh
  );
  if (ticketKwh === null) {
    return null;
  }

  const capacity = resolveBatteryCapacityFromInfo(
    vehicleInfo ?? (snapshot as { vehicleInfo?: unknown }).vehicleInfo
  );
  if (capacity === null) {
    return null;
  }

  const percentFromKwh = (ticketKwh / capacity) * 100;
  return clampBatteryPercent(startingBatteryPercent + percentFromKwh);
};

const calculateChargingBatteryPercentage = (
  progressPercent: number,
  startingBatteryPercent: number,
  targetBatteryPercent = 100
) => {
  const normalizedProgress = clampBatteryPercent(progressPercent);
  const normalizedStart = clampBatteryPercent(startingBatteryPercent);
  const normalizedTarget = clampBatteryPercent(targetBatteryPercent);

  const effectiveTarget = Math.max(normalizedStart, normalizedTarget);
  const remaining = effectiveTarget - normalizedStart;
  const estimatedPercent =
    normalizedStart + (remaining * normalizedProgress) / 100;

  return clampBatteryPercent(Math.min(effectiveTarget, estimatedPercent));
};

const appendChargingBatteryPercentage = <T extends Record<string, unknown>>(
  snapshot: T,
  progressPercent: number | null | undefined,
  vehicleInfo?: Record<string, unknown> | null
): T & { batteryPercentage?: number } => {
  if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) {
    return snapshot;
  }

  const startingBatteryPercent = resolveStartingBatteryPercent(
    snapshot,
    vehicleInfo
  );

  if (startingBatteryPercent === null) {
    return snapshot;
  }

  const targetBatteryPercent = resolveTargetBatteryPercent(
    snapshot,
    startingBatteryPercent,
    vehicleInfo
  );

  return {
    ...snapshot,
    batteryPercentage: calculateChargingBatteryPercentage(
      progressPercent,
      startingBatteryPercent,
      targetBatteryPercent ?? 100
    ),
  };
};

export {
  appendChargingBatteryPercentage,
  calculateChargingBatteryPercentage,
  clampBatteryPercent,
  resolveBatteryCapacityFromInfo,
  resolveStartingBatteryPercent,
  resolveTargetBatteryPercent,
};
