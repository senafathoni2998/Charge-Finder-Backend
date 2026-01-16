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

  const [stationInfo, vehicleInfo] = await Promise.all([
    fetchStationSnapshot(stationId),
    fetchActiveVehicleSnapshot(userId),
  ]);

  return {
    ...ticketSnapshot,
    stationInfo,
    vehicleInfo,
  };
};

export const finalizeChargingTicket = async (
  ticketId: string,
  userId: string
) => {
  const sess = await mongoose.startSession();
  sess.startTransaction();

  try {
    await User.updateOne(
      { _id: userId },
      { $pull: { tickets: ticketId } },
      { session: sess }
    );
    await ChargingTicket.deleteOne({ _id: ticketId }).session(sess);
    await sess.commitTransaction();
  } catch (err) {
    await sess.abortTransaction();
    throw err;
  } finally {
    sess.endSession();
  }
};
