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

  const { name, connector_type, min_power, email } = req.body;

  let user;
  try {
    user = await User.findOne({ email });
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

export { addNewVehicle };
