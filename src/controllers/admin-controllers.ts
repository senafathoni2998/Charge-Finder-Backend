import type { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import HttpError from "../models/http-error";
import User from "../models/user";
import Vehicle from "../models/vehicle";
import ChargingTicket from "../models/charging-ticket";

const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await User.find().select("-password").lean();
    res.status(200).json({ users });
  } catch (err) {
    return next(new HttpError("Fetching users failed, please try again.", 500));
  }
};

const createUser = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { name, email, password, region, role } = req.body;

  let existingUser;
  try {
    existingUser = await User.findOne({ email });
  } catch (err) {
    return next(new HttpError("Creating user failed, please try again.", 500));
  }

  if (existingUser) {
    return next(new HttpError("User exists already.", 422));
  }

  let hashedPassword;
  try {
    hashedPassword = await bcrypt.hash(password, 12);
  } catch (err) {
    return next(
      new HttpError("Could not create user, please try again.", 500)
    );
  }

  const newUser = new User({
    name,
    email,
    password: hashedPassword,
    region: region || "",
    role: role === "admin" ? "admin" : "user",
  });

  try {
    await newUser.save();
  } catch (err) {
    return next(new HttpError("Creating user failed, please try again.", 500));
  }

  const { password: _, ...userWithoutPassword } = newUser.toObject({
    getters: true,
  });

  res.status(201).json({
    message: "User created successfully!",
    user: userWithoutPassword,
  });
};

const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { userId } = req.params;
  const { name, region, email, role, password } = req.body;

  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Updating user failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  if (typeof email === "string" && email !== user.email) {
    let existingUser;
    try {
      existingUser = await User.findOne({ email });
    } catch (err) {
      return next(
        new HttpError("Updating user failed, please try again.", 500)
      );
    }

    if (existingUser) {
      return next(new HttpError("Email is already in use.", 422));
    }

    user.email = email;
  }

  if (typeof name === "string") {
    user.name = name;
  }

  if (typeof region === "string") {
    user.region = region;
  }

  if (role === "admin" || role === "user") {
    user.role = role;
  }

  if (typeof password === "string") {
    try {
      user.password = await bcrypt.hash(password, 12);
    } catch (err) {
      return next(
        new HttpError("Updating user failed, please try again.", 500)
      );
    }
  }

  try {
    await user.save();
  } catch (err) {
    return next(new HttpError("Updating user failed, please try again.", 500));
  }

  const { password: _, ...userWithoutPassword } = user.toObject({
    getters: true,
  });

  res.status(200).json({
    message: "User updated successfully!",
    user: userWithoutPassword,
  });
};

const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { userId } = req.params;

  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Deleting user failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await Vehicle.deleteMany({ owner: userId }).session(sess);
    await ChargingTicket.deleteMany({ user: userId }).session(sess);
    await user.deleteOne({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    return next(new HttpError("Deleting user failed, please try again.", 500));
  }

  res.status(200).json({ message: "User deleted successfully!" });
};

exports.getUsers = getUsers;
exports.createUser = createUser;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
