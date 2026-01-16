import mongoose from "mongoose";

import ChargingTicket from "../models/charging-ticket";
import User from "../models/user";

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
