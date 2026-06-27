import { validationResult } from "express-validator";

import Vehicle from "../../models/vehicle";
import User from "../../models/user";
import {
  refreshVehicleBatterySnapshot,
  refreshVehicleBatterySnapshots,
} from "../../services/vehicle-battery-service";
import { asyncHandler } from "../../middleware/async-handler";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../errors";

/**
 * Retrieves all vehicles owned by the authenticated user.
 *
 * DB errors are not caught here — they propagate to the central error middleware
 * (via asyncHandler) and become a 500. Only expected outcomes throw semantic errors.
 */
const getVehicles = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required.");
  }

  const userWithVehicles = await User.findById(req.user.id).populate("vehicles");

  if (!userWithVehicles || userWithVehicles.vehicles.length === 0) {
    throw new NotFoundError("Could not find vehicles for the provided user id.");
  }

  const vehicleSnapshots = userWithVehicles.vehicles.map((vehicle: any) =>
    vehicle.toObject({ getters: true })
  );

  const refreshedVehicles = await refreshVehicleBatterySnapshots(
    vehicleSnapshots
  );

  res.json({ vehicles: refreshedVehicles });
});

/**
 * Retrieves a specific vehicle by ID (owner-only).
 */
const getVehicleById = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError();
  }

  if (!req.user) {
    throw new UnauthorizedError("Authentication required.");
  }

  const { vehicleId } = req.params;
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw new NotFoundError("Vehicle not found.");
  }

  if (vehicle.owner.toString() !== req.user.id) {
    throw new ForbiddenError("Not authorized to view this vehicle.");
  }

  const vehicleSnapshot = vehicle.toObject({ getters: true });
  const refreshedVehicle = await refreshVehicleBatterySnapshot(vehicleSnapshot);

  res.status(200).json({ vehicle: refreshedVehicle ?? vehicleSnapshot });
});

export { getVehicles, getVehicleById };
