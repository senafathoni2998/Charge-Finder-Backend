import type { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";

import HttpError from "../models/http-error";
import User from "../models/user";

const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await User.find().select("-password").lean();
    res.status(200).json({ users });
  } catch (err) {
    return next(new HttpError("Fetching users failed, please try again.", 500));
  }
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

exports.getUsers = getUsers;
exports.updateUser = updateUser;
