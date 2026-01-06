import type { Request, Response, NextFunction } from "express";
import HttpError from "../models/http-error";

import User from "../models/user";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");

const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  // Implementation for getting user profile
  const userId = req.session?.user?.id;

  if (!userId) {
    return next(new HttpError("Not authenticated.", 401));
  }

  let user;
  try {
    user = await User.findById(userId).select("-password");
  } catch (err) {
    return next(new HttpError("Fetching profile failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  res.status(200).json({ user });
};

const passwordUpdate = async (req: Request, res: Response, next: NextFunction) => {
  // Implementation for password update
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }
  const { userId, currentPassword, newPassword } = req.body;

  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Password update failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  let isValidPassword = false;
  try {
    isValidPassword = await bcrypt.compare(currentPassword, user.password);
  } catch (err) {
    const error = new HttpError(
      "Could not update password, please try again",
      500
    );
    return next(error);
  }

  if (!isValidPassword) {
    return next(new HttpError("Current password is incorrect.", 401));
  }

  let hashedNewPassword;
  try {
    hashedNewPassword = await bcrypt.hash(newPassword, 12);
  } catch (err) {
    const error = new HttpError(
      "Could not update password, please try again",
      500
    );
    return next(error);
  }

  user.password = hashedNewPassword;

  try {
    await user.save();
  } catch (err) {
    return next(new HttpError("Password update failed, please try again.", 500));
  }

  res.status(200).json({ message: "Password updated successfully!" });
};

const profileUpdate = async (req: Request, res: Response, next: NextFunction) => {  
  // Implementation for profile update
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { name, region, userId } = req.body;
  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Profile update failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  user.name = name || user.name;
  user.region = region || user.region;

  try {
    await user.save();
  } catch (err) {
    return next(new HttpError("Profile update failed, please try again.", 500));
  }

  res.status(200).json({ message: "Profile updated successfully!" });
} 

exports.passwordUpdate = passwordUpdate;
exports.profileUpdate = profileUpdate;
exports.getProfile = getProfile;