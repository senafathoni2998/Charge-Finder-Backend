import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../models/http-error";
import Vehicle from "../../models/vehicle";
import User from "../../models/user";

const MAX_VEHICLES_PER_USER = 3;

/**
 * Adds a new vehicle to a user's account
 * 
 * @purpose Endpoint for users to register a new electric vehicle
 * @validates Validates input format and enforces vehicle limit per user
 * @limit Maximum 3 vehicles per user (configurable via MAX_VEHICLES_PER_USER)
 * @transaction Uses MongoDB session to ensure atomic creation of vehicle and user update
 * @body name, connector_type, min_power, userId, batteryCapacity (optional)
 * @returns JSON response with created vehicle details
 */
const addNewVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Validate request data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { name, connector_type, min_power, userId, batteryCapacity } = req.body;

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

  // Enforce vehicle limit per user
  let existingVehicleCount = 0;
  try {
    existingVehicleCount = await Vehicle.countDocuments({ owner: user._id });
  } catch (err) {
    return next(new HttpError("Creating vehicle failed, please try again.", 500));
  }

  if (existingVehicleCount >= MAX_VEHICLES_PER_USER) {
    return next(
      new HttpError(
        `Vehicle limit reached. Max ${MAX_VEHICLES_PER_USER} vehicles allowed.`,
        422
      )
    );
  }

  const newVehicle = new Vehicle({
    name,
    connector_type,
    min_power,
    owner: user._id,
  });
  if (typeof batteryCapacity === "number" && Number.isFinite(batteryCapacity)) {
    newVehicle.batteryCapacity = batteryCapacity;
  }

  // Create vehicle and update user in a transaction for data consistency
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

/**
 * Updates an existing vehicle's details
 * 
 * @purpose Endpoint for users to modify their registered vehicle information
 * @validates Validates input and ensures user owns the vehicle
 * @authorization Verifies user has permission to update the specified vehicle
 * @body vehicleId, name (optional), connector_type (optional), min_power (optional), userId, batteryCapacity (optional)
 * @returns JSON response with updated vehicle details
 */
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

  const { vehicleId, name, connector_type, min_power, userId, batteryCapacity } =
    req.body;
  const sessionUserId = req.user?.id;
  const effectiveUserId = userId || sessionUserId;

  if (!effectiveUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  // Verify session user is authorized to update this vehicle
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

  // Verify ownership before allowing update
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

  if (typeof batteryCapacity === "number" && Number.isFinite(batteryCapacity)) {
    vehicle.batteryCapacity = batteryCapacity;
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

/**
 * Sets a vehicle as the active/default vehicle for the user
 * 
 * @purpose Endpoint to designate which vehicle is currently in use
 * @behavior When activating a vehicle, automatically deactivates all other user vehicles
 * @transaction Uses MongoDB session to ensure only one vehicle is active at a time
 * @authorization Verifies user owns the vehicle before allowing status change
 * @body vehicleId, active (boolean), userId
 * @returns JSON response with updated vehicle details
 * @note Updates lastBatteryUpdatedAt timestamp when activating vehicle
 */
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

  const nextActive = typeof active === "boolean" ? active : true;

  // When activating, deactivate all other vehicles in a transaction
  if (nextActive) {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    try {
      await Vehicle.updateMany(
        { owner: effectiveUserId, _id: { $ne: vehicle._id }, active: true },
        { $set: { active: false } },
        { session: sess }
      );
      vehicle.active = true;
      vehicle.lastBatteryUpdatedAt = new Date();
      await vehicle.save({ session: sess });
      await sess.commitTransaction();
    } catch (err) {
      await sess.abortTransaction();
      return next(
        new HttpError("Updating vehicle failed, please try again.", 500)
      );
    } finally {
      sess.endSession();
    }
  } else {
    vehicle.active = false;
    try {
      await vehicle.save();
    } catch (err) {
      return next(
        new HttpError("Updating vehicle failed, please try again.", 500)
      );
    }
  }

  res.status(200).json({
    message: "Vehicle active status updated successfully!",
    vehicle: vehicle.toObject({ getters: true }),
  });
};

/**
 * Deletes a vehicle from the user's account
 * 
 * @purpose Endpoint for users to remove a registered vehicle
 * @authorization Verifies user owns the vehicle before allowing deletion
 * @transaction Uses MongoDB session to ensure atomic deletion from both vehicle and user collections
 * @cascade Removes vehicle reference from user's vehicles array
 * @body vehicleId, userId
 * @returns JSON response confirming deletion
 */
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

  // Delete vehicle and update user in a transaction to maintain referential integrity
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

export {
  addNewVehicle,
  updateVehicle,
  setActiveVehicle,
  deleteVehicle,
};
