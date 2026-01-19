import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../../models/http-error";
import Vehicle from "../../models/vehicle";
import User from "../../models/user";
import {
  refreshVehicleBatterySnapshot,
  refreshVehicleBatterySnapshots,
} from "../../services/vehicle-battery-service";

const getVehicles = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new HttpError("Authentication required.", 401));
  }

  const userId = req.user.id;

  let userWithVehicles;
  try {
    userWithVehicles = await User.findById(userId).populate("vehicles");
  } catch (err) {
    return next(
      new HttpError("Fetching vehicles failed, please try again later.", 500)
    );
  }

  if (!userWithVehicles || userWithVehicles.vehicles.length === 0) {
    return next(
      new HttpError("Could not find vehicles for the provided user id.", 404)
    );
  }

  const vehicleSnapshots = userWithVehicles.vehicles.map((vehicle: any) =>
    vehicle.toObject({ getters: true })
  );

  const refreshedVehicles = await refreshVehicleBatterySnapshots(
    vehicleSnapshots
  );

  res.json({
    vehicles: refreshedVehicles,
  });
};

const getVehicleById = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  if (!req.user) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { vehicleId } = req.params;

  let vehicle;
  try {
    vehicle = await Vehicle.findById(vehicleId);
  } catch (err) {
    return next(
      new HttpError("Fetching vehicle failed, please try again later.", 500)
    );
  }

  if (!vehicle) {
    return next(new HttpError("Vehicle not found.", 404));
  }

  if (vehicle.owner.toString() !== req.user.id) {
    return next(new HttpError("Not authorized to view this vehicle.", 403));
  }

  const vehicleSnapshot = vehicle.toObject({ getters: true });
  const refreshedVehicle = await refreshVehicleBatterySnapshot(vehicleSnapshot);

  res.status(200).json({
    vehicle: refreshedVehicle ?? vehicleSnapshot,
  });
};

export { getVehicles, getVehicleById };
