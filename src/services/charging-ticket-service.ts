import mongoose from "mongoose";

import ChargingTicket from "../models/charging-ticket";
import Station from "../models/station";
import User from "../models/user";
import Vehicle from "../models/vehicle";

export const CHARGING_DURATION_MS = 5 * 60 * 1000;

export const calculateChargingProgressPercent = (
  startedAt: Date | null | undefined,
  nowMs = Date.now()
) => {
  if (!startedAt) {
    return 0;
  }

  const elapsedMs = nowMs - startedAt.getTime();
  if (elapsedMs <= 0) {
    return 0;
  }

  const percent = (elapsedMs / CHARGING_DURATION_MS) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

export const calculateEstimatedCompletionAt = (
  startedAt: Date | null | undefined
) => {
  if (!startedAt) {
    return null;
  }

  const startedAtMs = startedAt.getTime();
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  return new Date(startedAtMs + CHARGING_DURATION_MS);
};

export const appendChargingEstimate = (
  ticketSnapshot: Record<string, unknown>,
  startedAt: Date | null | undefined
) => {
  const estimatedCompletionAt = calculateEstimatedCompletionAt(startedAt);
  if (!estimatedCompletionAt) {
    return ticketSnapshot;
  }

  return {
    ...ticketSnapshot,
    estimatedCompletionAt,
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
  ticketSnapshot = appendChargingEstimate(ticketSnapshot, startedAt);

  const userId = options.userId ?? resolveId(ticket.user);
  const stationId = options.stationId ?? resolveId(ticket.station);
  const ticketVehicleId = resolveId(ticket.vehicle);

  const [stationInfo, vehicleInfo] = await Promise.all([
    fetchStationSnapshot(stationId),
    ticketVehicleId
      ? fetchVehicleSnapshot(ticketVehicleId)
      : fetchActiveVehicleSnapshot(userId),
  ]);

  return {
    ...ticketSnapshot,
    stationInfo,
    vehicleInfo,
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
    { $set: { chargingStatus } },
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
    { $set: { chargingStatus } },
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
    { $set: { chargingStatus: "IDLE" } },
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
