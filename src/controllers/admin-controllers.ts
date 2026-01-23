import type { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import HttpError from "../models/http-error";
import User from "../models/user";
import Vehicle from "../models/vehicle";
import ChargingTicket from "../models/charging-ticket";
import {
  deletePublicImageFile,
  getPublicImagePathFromFile,
} from "../utils/image-paths";

/**
 * Retrieves all users from the database
 * 
 * @purpose Admin endpoint to fetch the complete list of registered users
 * @returns JSON response containing array of users (passwords excluded)
 * @security Only excludes password field from response for security
 */
const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Fetch all users excluding password field for security
    const users = await User.find().select("-password").lean();
    res.status(200).json({ users });
  } catch (err) {
    return next(new HttpError("Fetching users failed, please try again.", 500));
  }
};

/**
 * Creates a new user account (admin or regular user)
 * 
 * @purpose Admin endpoint to manually create user accounts with specified role
 * @validates Checks for duplicate email addresses before creation
 * @security Hashes password with bcrypt (12 salt rounds) before storing
 * @body name, email, password, region (optional), role (admin/user)
 * @returns JSON response with created user details (password excluded)
 */
const createUser = async (req: Request, res: Response, next: NextFunction) => {
  // Validate request data (from express-validator middleware)
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { name, email, password, region, role } = req.body;

  // Check if user with this email already exists
  let existingUser;
  try {
    existingUser = await User.findOne({ email });
  } catch (err) {
    return next(new HttpError("Creating user failed, please try again.", 500));
  }

  if (existingUser) {
    return next(new HttpError("User exists already.", 422));
  }

  // Hash password for secure storage
  let hashedPassword;
  try {
    hashedPassword = await bcrypt.hash(password, 12);
  } catch (err) {
    return next(
      new HttpError("Could not create user, please try again.", 500)
    );
  }

  // Create new user instance with sanitized role
  const newUser = new User({
    name,
    email,
    password: hashedPassword,
    region: region || "",
    role: role === "admin" ? "admin" : "user", // Only allow 'admin' or default to 'user'
  });

  try {
    await newUser.save();
  } catch (err) {
    return next(new HttpError("Creating user failed, please try again.", 500));
  }

  // Remove password from response object
  const { password: _, ...userWithoutPassword } = newUser.toObject({
    getters: true,
  });

  res.status(201).json({
    message: "User created successfully!",
    user: userWithoutPassword,
  });
};

/**
 * Updates an existing user's information
 * 
 * @purpose Admin endpoint to modify user details including role, profile image, and password
 * @validates Checks email uniqueness if email is being changed
 * @security Re-hashes password if provided, validates role changes
 * @imageHandling Supports profile image upload via multer, deletes old image on update
 * @params userId - User ID from URL params
 * @body name, region, email, role, password (all optional)
 * @file Profile image file (optional, handled by multer middleware)
 * @returns JSON response with updated user details (password excluded)
 */
const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  // Validate request data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { userId } = req.params;
  const { name, region, email, role, password } = req.body;

  // Fetch user to update
  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Updating user failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  // If email is being changed, verify it's not already in use
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

  // Update basic fields if provided
  if (typeof name === "string") {
    user.name = name;
  }

  if (typeof region === "string") {
    user.region = region;
  }

  // Handle profile image update
  const nextImagePath = req.file
    ? getPublicImagePathFromFile(req.file)
    : user.image;
  const previousImagePath = user.image;
  if (req.file) {
    user.image = nextImagePath;
  }

  // Update role if valid value provided
  if (role === "admin" || role === "user") {
    user.role = role;
  }

  // Update password if provided (re-hash for security)
  if (typeof password === "string") {
    try {
      user.password = await bcrypt.hash(password, 12);
    } catch (err) {
      return next(
        new HttpError("Updating user failed, please try again.", 500)
      );
    }
  }

  // Save updated user to database
  try {
    await user.save();
  } catch (err) {
    return next(new HttpError("Updating user failed, please try again.", 500));
  }

  // Clean up old profile image if it was replaced
  if (req.file && previousImagePath && previousImagePath !== nextImagePath) {
    try {
      await deletePublicImageFile(previousImagePath);
    } catch (err) {
      return next(
        new HttpError(
          "User updated, but removing the previous image failed.",
          500
        )
      );
    }
  }

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user.toObject({
    getters: true,
  });

  res.status(200).json({
    message: "User updated successfully!",
    user: userWithoutPassword,
  });
};

/**
 * Deletes a user and all associated data
 * 
 * @purpose Admin endpoint to completely remove a user from the system
 * @cascade Deletes all user's vehicles and charging tickets in a transaction
 * @transaction Uses MongoDB session to ensure atomic deletion of related data
 * @cleanup Removes user's profile image from file system after successful deletion
 * @params userId - User ID from URL params
 * @returns JSON response confirming deletion
 */
const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
  // Validate request data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { userId } = req.params;

  // Fetch user to delete
  let user;
  try {
    user = await User.findById(userId);
  } catch (err) {
    return next(new HttpError("Deleting user failed, please try again.", 500));
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  const imagePath = user.image;

  // Delete user and all related data in a transaction to ensure data consistency
  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    
    // Remove all vehicles owned by this user
    await Vehicle.deleteMany({ owner: userId }).session(sess);
    
    // Remove all charging tickets associated with this user
    await ChargingTicket.deleteMany({ user: userId }).session(sess);
    
    // Remove the user account
    await user.deleteOne({ session: sess });
    
    await sess.commitTransaction();
  } catch (err) {
    return next(new HttpError("Deleting user failed, please try again.", 500));
  }

  // Clean up profile image from file system if exists
  if (imagePath) {
    try {
      await deletePublicImageFile(imagePath);
    } catch (err) {
      return next(
        new HttpError(
          "User deleted, but removing the profile image failed.",
          500
        )
      );
    }
  }

  res.status(200).json({ message: "User deleted successfully!" });
};

export {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
};
