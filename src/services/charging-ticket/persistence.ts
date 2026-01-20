import mongoose from "mongoose";

import ChargingTicket from "../../models/charging-ticket";
import Station from "../../models/station";
import User from "../../models/user";
import Vehicle from "../../models/vehicle";
import { calculateBatteryStatus } from "../vehicle-battery-service";
import { clampBatteryPercent } from "./battery";
import { resolveId } from "./snapshot";

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

const finalizeChargingTicket = async (ticketId: string, userId: string) => {
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

export {
  adjustStationConnectorAvailability,
  clearChargingStatusForUserVehicles,
  finalizeChargingTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
  updateVehicleBatteryPercentage,
};
