import Vehicle from "../models/vehicle";

export type BatteryStatus = "FULL" | "HIGH" | "MEDIUM" | "LOW" | "CRITICAL";

const BATTERY_DRAIN_TICK_MS = 10 * 60_000;
const BATTERY_DRAIN_STEP = 5;
const BATTERY_PERCENT_DEFAULT = 100;

const isBatteryStatus = (value: unknown): value is BatteryStatus => {
  return (
    value === "FULL" ||
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "CRITICAL"
  );
};

const clampBatteryPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return BATTERY_PERCENT_DEFAULT;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

const parseBatteryUpdatedAt = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const resolveVehicleId = (snapshot: Record<string, unknown>) => {
  const id = snapshot.id;
  if (typeof id === "string") {
    return id;
  }

  const rawId = snapshot._id;
  if (typeof rawId === "string") {
    return rawId;
  }

  if (
    rawId &&
    typeof (rawId as { toString?: () => string }).toString === "function"
  ) {
    return (rawId as { toString: () => string }).toString();
  }

  return null;
};

export const calculateBatteryStatus = (percent: number): BatteryStatus => {
  if (percent >= 80) {
    return "FULL";
  }
  if (percent >= 60) {
    return "HIGH";
  }
  if (percent >= 40) {
    return "MEDIUM";
  }
  if (percent >= 20) {
    return "LOW";
  }
  return "CRITICAL";
};

export const ensureVehicleBatteryDefaults = async () => {
  await Vehicle.updateMany(
    { batteryPercent: { $exists: false } },
    { $set: { batteryPercent: BATTERY_PERCENT_DEFAULT } }
  );

  await Vehicle.updateMany(
    { lastBatteryUpdatedAt: { $exists: false } },
    { $set: { lastBatteryUpdatedAt: new Date() } }
  );

  const missingStatus = await Vehicle.find(
    { batteryStatus: { $exists: false } },
    { batteryPercent: 1 }
  ).lean();

  if (missingStatus.length === 0) {
    return;
  }

  const updates = missingStatus.map((vehicle) => {
    const percent = clampBatteryPercent(
      typeof vehicle.batteryPercent === "number"
        ? vehicle.batteryPercent
        : BATTERY_PERCENT_DEFAULT
    );
    const status = calculateBatteryStatus(percent);

    return {
      updateOne: {
        filter: { _id: vehicle._id },
        update: { $set: { batteryPercent: percent, batteryStatus: status } },
      },
    };
  });

  if (updates.length > 0) {
    await Vehicle.bulkWrite(updates, { ordered: false });
  }
};

const buildBatteryUpdate = (
  snapshot: Record<string, unknown>,
  nowMs: number
) => {
  const currentPercent = clampBatteryPercent(
    typeof snapshot.batteryPercent === "number"
      ? snapshot.batteryPercent
      : BATTERY_PERCENT_DEFAULT
  );

  const currentStatus = isBatteryStatus(snapshot.batteryStatus)
    ? snapshot.batteryStatus
    : null;

  const normalizedCurrentStatus =
    currentStatus ?? calculateBatteryStatus(currentPercent);

  const active = snapshot.active === true;
  const chargingStatus =
    typeof snapshot.chargingStatus === "string" ? snapshot.chargingStatus : null;

  const lastUpdatedAt = parseBatteryUpdatedAt(snapshot.lastBatteryUpdatedAt);
  let nextPercent = currentPercent;
  let nextStatus = calculateBatteryStatus(currentPercent);
  let nextLastUpdatedAt = lastUpdatedAt ?? new Date(nowMs);

  if (active && chargingStatus !== "CHARGING" && lastUpdatedAt) {
    const elapsedMs = nowMs - lastUpdatedAt.getTime();
    if (elapsedMs >= BATTERY_DRAIN_TICK_MS) {
      const steps = Math.floor(elapsedMs / BATTERY_DRAIN_TICK_MS);
      nextPercent = clampBatteryPercent(
        currentPercent - steps * BATTERY_DRAIN_STEP
      );
      nextStatus = calculateBatteryStatus(nextPercent);
      nextLastUpdatedAt = new Date(
        lastUpdatedAt.getTime() + steps * BATTERY_DRAIN_TICK_MS
      );
    }
  }

  if (!active || chargingStatus === "CHARGING") {
    nextStatus = calculateBatteryStatus(currentPercent);
  }

  const lastUpdatedMs = lastUpdatedAt ? lastUpdatedAt.getTime() : null;
  const nextUpdatedMs = nextLastUpdatedAt.getTime();

  const updateNeeded =
    nextPercent !== currentPercent ||
    nextStatus !== normalizedCurrentStatus ||
    lastUpdatedMs === null ||
    nextUpdatedMs !== lastUpdatedMs;

  const updatedSnapshot = {
    ...snapshot,
    batteryPercent: nextPercent,
    batteryStatus: nextStatus,
    lastBatteryUpdatedAt: nextLastUpdatedAt,
  };

  const update = updateNeeded
    ? {
        batteryPercent: nextPercent,
        batteryStatus: nextStatus,
        lastBatteryUpdatedAt: nextLastUpdatedAt,
      }
    : null;

  return { updatedSnapshot, update };
};

export const refreshVehicleBatterySnapshots = async (
  snapshots: Record<string, unknown>[]
) => {
  if (snapshots.length === 0) {
    return [];
  }

  const nowMs = Date.now();
  const updates: {
    updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
  }[] = [];

  const updatedSnapshots = snapshots.map((snapshot) => {
    const { updatedSnapshot, update } = buildBatteryUpdate(snapshot, nowMs);
    const vehicleId = resolveVehicleId(snapshot);

    if (update && vehicleId) {
      updates.push({
        updateOne: {
          filter: { _id: vehicleId },
          update: { $set: update },
        },
      });
    }

    return updatedSnapshot;
  });

  if (updates.length > 0) {
    await Vehicle.bulkWrite(updates, { ordered: false });
  }

  return updatedSnapshots;
};

export const refreshVehicleBatterySnapshot = async (
  snapshot: Record<string, unknown> | null
) => {
  if (!snapshot) {
    return null;
  }

  const [updatedSnapshot] = await refreshVehicleBatterySnapshots([snapshot]);
  return updatedSnapshot ?? snapshot;
};
