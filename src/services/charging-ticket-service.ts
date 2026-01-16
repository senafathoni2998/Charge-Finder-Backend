import mongoose from "mongoose";

import ChargingTicket from "../models/charging-ticket";
import Station from "../models/station";
import User from "../models/user";
import Vehicle from "../models/vehicle";
import {
  calculateBatteryStatus,
  refreshVehicleBatterySnapshot,
} from "./vehicle-battery-service";

export const CHARGING_DURATION_MS = 5 * 60 * 1000;
export const CHARGING_PERCENT_INTERVAL_MS = 30 * 1000;

const clampBatteryPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

export const calculateChargingProgressPercent = (
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

export const calculateEstimatedCompletionAt = (
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

export const appendChargingEstimate = (
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

export const calculateChargingDurationMs = (
  batteryPercent: number | null | undefined
) => {
  if (typeof batteryPercent !== "number" || !Number.isFinite(batteryPercent)) {
    return CHARGING_DURATION_MS;
  }

  const normalizedPercent = clampBatteryPercent(batteryPercent);
  return Math.max(0, (100 - normalizedPercent) * CHARGING_PERCENT_INTERVAL_MS);
};

export const calculateChargingBatteryPercentage = (
  progressPercent: number,
  startingBatteryPercent: number
) => {
  const normalizedProgress = clampBatteryPercent(progressPercent);
  const normalizedStart = clampBatteryPercent(startingBatteryPercent);
  const remaining = 100 - normalizedStart;
  const estimatedPercent = normalizedStart + (remaining * normalizedProgress) / 100;
  return clampBatteryPercent(estimatedPercent);
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

export const appendChargingBatteryPercentage = <
  T extends Record<string, unknown>
>(
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

  return {
    ...snapshot,
    batteryPercentage: calculateChargingBatteryPercentage(
      progressPercent,
      startingBatteryPercent
    ),
  };
};

const toSnapshot = (doc: any): Record<string, unknown> => {
  if (!doc) {
    return {};
  }

  return doc.toObject ? doc.toObject({ getters: true }) : { ...doc };
};

const resolveId = (value: any): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.id === "string") {
      return value.id;
    }

    if (typeof value._id === "string") {
      return value._id;
    }

    if (value._id?.toString) {
      return value._id.toString();
    }

    if (value.toString) {
      const stringified = value.toString();
      return stringified === "[object Object]" ? null : stringified;
    }
  }

  return null;
};

export const updateVehicleBatteryPercentage = async (
  vehicleId: unknown,
  batteryPercent: number | null | undefined,
  session?: mongoose.ClientSession
) => {
  const resolvedVehicleId = resolveId(vehicleId);
  if (
    !resolvedVehicleId ||
    typeof batteryPercent !== "number" ||
    !Number.isFinite(batteryPercent)
  ) {
    return { ok: false };
  }

  const normalizedPercent = clampBatteryPercent(batteryPercent);
  const batteryStatus = calculateBatteryStatus(normalizedPercent);
  const options = session ? { session } : undefined;
  const result = await Vehicle.updateOne(
    { _id: resolvedVehicleId },
    {
      $set: {
        batteryPercent: normalizedPercent,
        batteryStatus,
        lastBatteryUpdatedAt: new Date(),
      },
    },
    options
  );

  return { ok: result.matchedCount > 0, batteryPercent: normalizedPercent };
};

const fetchStationSnapshot = async (
  stationId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!stationId) {
    return null;
  }

  try {
    const station = await Station.findById(stationId);
    return station ? station.toObject({ getters: true }) : null;
  } catch (err) {
    return null;
  }
};

const fetchActiveVehicleSnapshot = async (
  userId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!userId) {
    return null;
  }

  try {
    const vehicle = await Vehicle.findOne({ owner: userId, active: true }).sort({
      _id: -1,
    });
    return vehicle ? vehicle.toObject({ getters: true }) : null;
  } catch (err) {
    return null;
  }
};

const fetchVehicleSnapshot = async (
  vehicleId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!vehicleId) {
    return null;
  }

  try {
    const vehicle = await Vehicle.findById(vehicleId);
    return vehicle ? vehicle.toObject({ getters: true }) : null;
  } catch (err) {
    return null;
  }
};

export const resolveChargingDurationMsFromSnapshot = (
  snapshot: Record<string, unknown>,
  vehicleInfo?: Record<string, unknown> | null
) => {
  const rawDuration = snapshot.chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration);
  }

  const batteryPercent = resolveStartingBatteryPercent(snapshot, vehicleInfo);

  if (batteryPercent !== null) {
    return calculateChargingDurationMs(batteryPercent);
  }

  return CHARGING_DURATION_MS;
};

export const resolveChargingDurationMsForTicket = async (ticket: any) => {
  if (!ticket) {
    return CHARGING_DURATION_MS;
  }

  const rawDuration = ticket.chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration);
  }

  const rawStartingPercent = ticket.startingBatteryPercent;
  if (
    typeof rawStartingPercent === "number" &&
    Number.isFinite(rawStartingPercent)
  ) {
    return calculateChargingDurationMs(rawStartingPercent);
  }

  const vehicleId = resolveId(ticket.vehicle);
  if (!vehicleId) {
    return CHARGING_DURATION_MS;
  }

  try {
    const vehicle = await Vehicle.findById(vehicleId, {
      batteryPercent: 1,
    }).lean();
    if (!vehicle || typeof vehicle.batteryPercent !== "number") {
      return CHARGING_DURATION_MS;
    }
    return calculateChargingDurationMs(vehicle.batteryPercent);
  } catch (err) {
    return CHARGING_DURATION_MS;
  }
};

export const buildChargingTicketPayload = async (
  ticket: any,
  options: { userId?: string; stationId?: string } = {}
) => {
  if (!ticket) {
    return null;
  }

  let ticketSnapshot = toSnapshot(ticket);
  const startedAtValue =
    ticket.startedAt ?? (ticketSnapshot as { startedAt?: unknown }).startedAt;
  const startedAt = startedAtValue ? new Date(startedAtValue as Date) : null;

  const userId = options.userId ?? resolveId(ticket.user);
  const stationId = options.stationId ?? resolveId(ticket.station);
  const ticketVehicleId = resolveId(ticket.vehicle);

  const [stationInfo, vehicleInfo] = await Promise.all([
    fetchStationSnapshot(stationId),
    ticketVehicleId
      ? fetchVehicleSnapshot(ticketVehicleId)
      : fetchActiveVehicleSnapshot(userId),
  ]);
  const hydratedVehicleInfo = await refreshVehicleBatterySnapshot(vehicleInfo);
  const durationMs = resolveChargingDurationMsFromSnapshot(
    ticketSnapshot,
    hydratedVehicleInfo
  );
  ticketSnapshot = appendChargingEstimate(ticketSnapshot, startedAt, durationMs);
  ticketSnapshot = appendChargingBatteryPercentage(
    ticketSnapshot,
    typeof ticketSnapshot.progressPercent === "number"
      ? ticketSnapshot.progressPercent
      : null,
    hydratedVehicleInfo
  );

  return {
    ...ticketSnapshot,
    stationInfo,
    vehicleInfo: hydratedVehicleInfo,
  };
};

export type VehicleChargingStatus = "IDLE" | "CHARGING";

export const setVehicleChargingStatus = async (
  vehicleId: string,
  chargingStatus: VehicleChargingStatus,
  session?: mongoose.ClientSession
) => {
  if (!vehicleId) {
    return { ok: false };
  }

  const options = session ? { session } : undefined;
  const result = await Vehicle.updateOne(
    { _id: vehicleId },
    { $set: { chargingStatus, lastBatteryUpdatedAt: new Date() } },
    options
  );

  return { ok: result.matchedCount > 0 };
};

export const setActiveVehicleChargingStatus = async (
  userId: string,
  chargingStatus: VehicleChargingStatus,
  session?: mongoose.ClientSession
) => {
  if (!userId) {
    return { ok: false };
  }

  const options = session ? { session } : undefined;
  const result = await Vehicle.updateOne(
    { owner: userId, active: true },
    { $set: { chargingStatus, lastBatteryUpdatedAt: new Date() } },
    options
  );

  return { ok: result.matchedCount > 0 };
};

export const clearChargingStatusForUserVehicles = async (
  userId: string,
  session?: mongoose.ClientSession
) => {
  if (!userId) {
    return;
  }

  const options = session ? { session } : undefined;
  await Vehicle.updateMany(
    { owner: userId, chargingStatus: "CHARGING" },
    { $set: { chargingStatus: "IDLE", lastBatteryUpdatedAt: new Date() } },
    options
  );
};

type AdjustAvailabilityResult = {
  ok: boolean;
  reason?: "no_available_ports" | "not_found";
};

export const adjustStationConnectorAvailability = async (
  stationId: string,
  connectorType: string,
  delta: number,
  session?: mongoose.ClientSession
): Promise<AdjustAvailabilityResult> => {
  if (!stationId || !connectorType || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, reason: "not_found" };
  }

  const query: Record<string, unknown> = {
    _id: stationId,
    "connectors.type": connectorType,
  };

  if (delta < 0) {
    query["connectors.availablePorts"] = { $gt: 0 };
  }

  const options = session ? { session } : undefined;
  const result = await Station.updateOne(
    query,
    { $inc: { "connectors.$.availablePorts": delta } },
    options
  );

  if (result.matchedCount === 0) {
    return { ok: false, reason: delta < 0 ? "no_available_ports" : "not_found" };
  }

  return { ok: true };
};

export const finalizeChargingTicket = async (
  ticketId: string,
  userId: string
) => {
  const sess = await mongoose.startSession();
  sess.startTransaction();

  try {
    const deletedTicket = await ChargingTicket.findOneAndDelete({
      _id: ticketId,
    }).session(sess);

    await User.updateOne(
      { _id: userId },
      { $pull: { tickets: ticketId } },
      { session: sess }
    );

    if (deletedTicket?.connectorType) {
      const stationId = resolveId(deletedTicket.station);
      if (stationId) {
        await adjustStationConnectorAvailability(
          stationId,
          deletedTicket.connectorType,
          1,
          sess
        );
      }
    }

    if (deletedTicket?.vehicle) {
      const vehicleId = resolveId(deletedTicket.vehicle);
      if (vehicleId) {
        await setVehicleChargingStatus(vehicleId, "IDLE", sess);
      }
    } else {
      await clearChargingStatusForUserVehicles(userId, sess);
    }

    await sess.commitTransaction();
  } catch (err) {
    await sess.abortTransaction();
    throw err;
  } finally {
    sess.endSession();
  }
};
