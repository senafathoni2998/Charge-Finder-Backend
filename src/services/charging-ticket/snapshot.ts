import Station from "../../models/station";
import Vehicle from "../../models/vehicle";

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

export {
  fetchActiveVehicleSnapshot,
  fetchStationSnapshot,
  fetchVehicleSnapshot,
  resolveId,
  toSnapshot,
};
