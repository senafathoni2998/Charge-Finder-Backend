import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../models/http-error";
import Vehicle from "../models/vehicle";
import User from "../models/user";
import mongoose from "mongoose";

const addNewVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Implementation for adding a new vehicle
  const errors = validationResult(req);
  console.log("Validation Errors:", errors.array());
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { name, connector_type, min_power, userId } = req.body;

  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again.", 500));
  }

  if (!user) {
    return next(
      new HttpError("User does not exist, please signup instead.", 422)
    );
  }

  let newVehicle = new Vehicle({
    name,
    connector_type,
    min_power,
    owner: user._id,
  });

  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await newVehicle.save({ session: sess });
    user.vehicles.push(newVehicle._id);
    await user.save({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    console.error(err);
    return next(new HttpError("Creating place failed, please try again.", 500));
  }

  res
    .status(201)
    .json({ message: "New vehicle added successfully!", vehicle: newVehicle });
};

const updateVehicle = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  console.log("Validation Errors:", errors.array());
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { vehicleId, name, connector_type, min_power, userId } = req.body;
  const sessionUserId = req.user?.id;
  const effectiveUserId = userId || sessionUserId;

  if (!effectiveUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  if (sessionUserId && userId && sessionUserId !== userId) {
    return next(new HttpError("Not authorized to update this vehicle.", 403));
  }

  let vehicle;
  try {
    vehicle = await Vehicle.findById(vehicleId);
  } catch (err) {
    return next(
      new HttpError("Updating vehicle failed, please try again.", 500)
    );
  }

  if (!vehicle) {
    return next(new HttpError("Vehicle not found.", 404));
  }

  if (vehicle.owner.toString() !== effectiveUserId) {
    return next(new HttpError("Not authorized to update this vehicle.", 403));
  }

  if (typeof name === "string") {
    vehicle.name = name;
  }

  if (Array.isArray(connector_type)) {
    vehicle.connector_type = connector_type;
  }

  if (min_power !== undefined) {
    vehicle.min_power = min_power;
  }

  try {
    await vehicle.save();
  } catch (err) {
    return next(
      new HttpError("Updating vehicle failed, please try again.", 500)
    );
  }

  res.status(200).json({
    message: "Vehicle updated successfully!",
    vehicle: vehicle.toObject({ getters: true }),
  });
};

const setActiveVehicle = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  console.log("Validation Errors:", errors.array());
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { vehicleId, active, userId } = req.body;
  const sessionUserId = req.user?.id;
  const effectiveUserId = userId || sessionUserId;

  if (!effectiveUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  if (sessionUserId && userId && sessionUserId !== userId) {
    return next(new HttpError("Not authorized to update this vehicle.", 403));
  }

  let vehicle;
  try {
    vehicle = await Vehicle.findById(vehicleId);
  } catch (err) {
    return next(
      new HttpError("Updating vehicle failed, please try again.", 500)
    );
  }

  if (!vehicle) {
    return next(new HttpError("Vehicle not found.", 404));
  }

  if (vehicle.owner.toString() !== effectiveUserId) {
    return next(new HttpError("Not authorized to update this vehicle.", 403));
  }

  vehicle.active = typeof active === "boolean" ? active : true;

  try {
    await vehicle.save();
  } catch (err) {
    return next(
      new HttpError("Updating vehicle failed, please try again.", 500)
    );
  }

  res.status(200).json({
    message: "Vehicle active status updated successfully!",
    vehicle: vehicle.toObject({ getters: true }),
  });
};

const deleteVehicle = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  console.log("Validation Errors:", errors.array());
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { vehicleId, userId } = req.body;
  const sessionUserId = req.user?.id;
  const effectiveUserId = userId || sessionUserId;

  if (!effectiveUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  if (sessionUserId && userId && sessionUserId !== userId) {
    return next(new HttpError("Not authorized to delete this vehicle.", 403));
  }

  let vehicle;
  try {
    vehicle = await Vehicle.findById(vehicleId);
  } catch (err) {
    return next(
      new HttpError("Deleting vehicle failed, please try again.", 500)
    );
  }

  if (!vehicle) {
    return next(new HttpError("Vehicle not found.", 404));
  }

  if (vehicle.owner.toString() !== effectiveUserId) {
    return next(new HttpError("Not authorized to delete this vehicle.", 403));
  }

  let user;
  try {
    user = await User.findById(vehicle.owner);
  } catch (err) {
    return next(
      new HttpError("Deleting vehicle failed, please try again.", 500)
    );
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await vehicle.deleteOne({ session: sess });
    user.vehicles = user.vehicles.filter(
      (id: mongoose.Types.ObjectId) => id.toString() !== vehicle._id.toString()
    );
    await user.save({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    return next(
      new HttpError("Deleting vehicle failed, please try again.", 500)
    );
  }

  res.status(200).json({ message: "Vehicle deleted successfully!" });
};

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

  res.json({
    vehicles: userWithVehicles.vehicles.map((vehicle: any) =>
      vehicle.toObject({ getters: true })
    ),
  });
};

export { addNewVehicle, getVehicles, updateVehicle, setActiveVehicle, deleteVehicle };
