import mongoose from "mongoose";

import ChargingTicket from "../../models/charging-ticket";
import Station from "../../models/station";
import User from "../../models/user";
import Vehicle from "../../models/vehicle";
import { calculateBatteryStatus } from "../vehicle-battery-service";
import { clampBatteryPercent } from "./battery";
import { resolveId } from "./snapshot";
import {
  recordChargingHistory,
  type ChargingHistoryOutcome,
} from "../charging-history-service";

const updateVehicleBatteryPercentage = async (
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

export type VehicleChargingStatus = "IDLE" | "CHARGING";

const setVehicleChargingStatus = async (
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

const setActiveVehicleChargingStatus = async (
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

const clearChargingStatusForUserVehicles = async (
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

const adjustStationConnectorAvailability = async (
  stationId: string,
  connectorType: string,
  delta: number,
  session?: mongoose.ClientSession
): Promise<AdjustAvailabilityResult> => {
  if (!stationId || !connectorType || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, reason: "not_found" };
  }

  // Use $elemMatch so the type filter, the availability guard, and the positional
  // ($) update all bind to the SAME connector. With separate dotted conditions
  // MongoDB can satisfy "some connector has the type" and "some (other) connector
  // has ports", then decrement the wrong element below zero (overbooking).
  const query: Record<string, unknown> = {
    _id: stationId,
    connectors: {
      $elemMatch:
        delta < 0
          ? { type: connectorType, availablePorts: { $gt: 0 } }
          : { type: connectorType },
    },
  };

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

type FinalizeChargingTicketOptions = {
  ticketSnapshot?: Record<string, unknown>;
  outcome?: ChargingHistoryOutcome;
  endedAt?: Date;
  vehicleBatteryPercent?: number | null;
};

const finalizeChargingTicket = async (
  ticketId: string,
  userId: string,
  options: FinalizeChargingTicketOptions = {}
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

    // Only release a port if this ticket actually reserved one. connectorType is
    // set at request time, but a reservation only happens when charging starts —
    // releasing on connectorType alone inflates availablePorts above the physical
    // port count for tickets that were requested/cancelled but never started.
    if (deletedTicket?.portReserved && deletedTicket?.connectorType) {
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

    // Write charging history and the final battery level in the SAME transaction,
    // so a completed/cancelled session can never leave the ticket finalized while
    // history/battery silently diverge.
    if (deletedTicket && options.ticketSnapshot && options.outcome) {
      await recordChargingHistory({
        userId,
        ticketSnapshot: options.ticketSnapshot,
        outcome: options.outcome,
        endedAt: options.endedAt ?? new Date(),
        session: sess,
      });
    }

    if (deletedTicket && typeof options.vehicleBatteryPercent === "number") {
      const vehicleId = resolveId(deletedTicket.vehicle);
      if (vehicleId) {
        await updateVehicleBatteryPercentage(
          vehicleId,
          options.vehicleBatteryPercent,
          sess
        );
      }
    }

    await sess.commitTransaction();
  } catch (err) {
    await sess.abortTransaction();
    throw err;
  } finally {
    sess.endSession();
  }
};

export {
  adjustStationConnectorAvailability,
  clearChargingStatusForUserVehicles,
  finalizeChargingTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
  updateVehicleBatteryPercentage,
};
