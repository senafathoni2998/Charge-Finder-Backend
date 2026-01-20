import Vehicle from "../../models/vehicle";
import {
  CHARGING_DURATION_MS,
  getMaxChargingDurationMs,
  resolveChargingSpeed,
} from "./constants";
import { calculateChargingDurationMs } from "./calculations";
import {
  resolveStartingBatteryPercent,
  resolveTargetBatteryPercent,
} from "./battery";
import { resolveId } from "./snapshot";

const resolveChargingDurationMsFromSnapshot = (
  snapshot: Record<string, unknown>,
  vehicleInfo?: Record<string, unknown> | null
) => {
  const rawDuration = (snapshot as { chargingDurationMs?: unknown })
    .chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration);
  }

  const batteryPercent = resolveStartingBatteryPercent(snapshot, vehicleInfo);
  const targetBatteryPercent = resolveTargetBatteryPercent(
    snapshot,
    batteryPercent,
    vehicleInfo
  );
  const chargingSpeed = resolveChargingSpeed(
    (snapshot as { chargingSpeed?: unknown }).chargingSpeed
  );

  if (batteryPercent !== null) {
    return calculateChargingDurationMs(
      batteryPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  }

  return getMaxChargingDurationMs(chargingSpeed);
};

const resolveChargingDurationMsForTicket = async (ticket: any) => {
  if (!ticket) {
    return CHARGING_DURATION_MS;
  }

  const rawDuration = ticket.chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration);
  }

  const chargingSpeed = resolveChargingSpeed(ticket.chargingSpeed);

  const rawStartingPercent = ticket.startingBatteryPercent;
  if (
    typeof rawStartingPercent === "number" &&
    Number.isFinite(rawStartingPercent)
  ) {
    const targetBatteryPercent = resolveTargetBatteryPercent(
      ticket,
      rawStartingPercent,
      null
    );
    return calculateChargingDurationMs(
      rawStartingPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  }

  const vehicleId = resolveId(ticket.vehicle);
  if (!vehicleId) {
    return CHARGING_DURATION_MS;
  }

  try {
    const vehicle = await Vehicle.findById(vehicleId, {
      batteryPercent: 1,
      batteryCapacity: 1,
    }).lean();

    if (!vehicle || typeof vehicle.batteryPercent !== "number") {
      return getMaxChargingDurationMs(chargingSpeed);
    }

    const targetBatteryPercent = resolveTargetBatteryPercent(
      ticket,
      vehicle.batteryPercent,
      vehicle as Record<string, unknown>
    );
    return calculateChargingDurationMs(
      vehicle.batteryPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  } catch (err) {
    return getMaxChargingDurationMs(chargingSpeed);
  }
};

export { resolveChargingDurationMsForTicket, resolveChargingDurationMsFromSnapshot };
