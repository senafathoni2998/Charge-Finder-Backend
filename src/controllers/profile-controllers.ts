import type { Request, Response, NextFunction } from "express";
import HttpError from "../models/http-error";

import User from "../models/user";
import { fetchChargingHistoryForUser } from "../services/charging-history-service";
import {
  deletePublicImageFile,
  getPublicImagePathFromFile,
} from "../utils/image-paths";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");

/**
 * Retrieves the authenticated user's profile information
 * 
 * @purpose Endpoint for users to view their own profile details
 * @authentication Requires active session with user ID
 * @security Excludes password field from response
 * @returns JSON response with user profile data (password excluded)
 */
const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  // Extract user ID from the current session
  // The session is set when user logs in and contains user.id
  const userId = req.session?.user?.id;

  // Check if user is authenticated (has valid session)
  // If no userId in session, user needs to login first
  if (!userId) {
    return next(new HttpError("Not authenticated.", 401));
  }

  // Initialize variable to hold user data from database
  let user;
  try {
    // Query MongoDB to find user by their ID
    // .select("-password") excludes password field from response for security
    // This ensures password hash is never sent to client
    user = await User.findById(userId).select("-password");
  } catch (err) {
    // If database query fails, return 500 Internal Server Error
    // This could happen if DB connection is lost or query is malformed
    return next(
      new HttpError("Fetching profile failed, please try again.", 500)
    );
  }

  // Check if user exists in database
  // This shouldn't normally happen since userId comes from session,
  // but user could have been deleted after logging in
  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  // Send successful response with user profile data
  // Status 200 = OK, user object contains all profile fields except password
  res.status(200).json({ user });
};

/**
 * Updates a user's password after verifying current password
 * 
 * @purpose Endpoint for users to change their account password
 * @validates Validates input format through express-validator
 * @security Verifies current password before allowing change, hashes new password with bcrypt
 * @body userId, currentPassword, newPassword
 * @returns JSON response confirming password update
 */
const passwordUpdate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Validate request data using express-validator middleware rules
  // This checks if userId, currentPassword, and newPassword are present and valid
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Return 422 Unprocessable Entity if validation fails
    // This means request format is wrong (e.g., missing fields, invalid types)
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }
  
  // Extract required fields from request body
  // userId: ID of user changing password
  // currentPassword: User's existing password (for verification)
  // newPassword: The new password user wants to set
  const { userId, currentPassword, newPassword } = req.body;

  // Initialize variable to hold user document from database
  let user;
  try {
    // Find user by ID - this time we DON'T exclude password
    // because we need to compare it with currentPassword
    user = await User.findById(userId);
  } catch (err) {
    // If database query fails, return 500 error
    return next(
      new HttpError("Password update failed, please try again.", 500)
    );
  }

  // Verify user exists in database
  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  // Verify current password is correct before allowing change
  // This is a critical security step - prevents unauthorized password changes
  let isValidPassword = false;
  try {
    // Use bcrypt.compare to check if currentPassword matches stored hash
    // bcrypt.compare(plaintext, hash) returns true if they match
    // This is secure because we never decrypt the stored password
    isValidPassword = await bcrypt.compare(currentPassword, user.password);
  } catch (err) {
    // If bcrypt comparison fails (rare), return 500 error
    const error = new HttpError(
      "Could not update password, please try again",
      500
    );
    return next(error);
  }

  // If current password doesn't match, reject the request
  // Return 401 Unauthorized - user cannot prove they own this account
  if (!isValidPassword) {
    return next(new HttpError("Current password is incorrect.", 401));
  }

  // Hash new password for secure storage
  // NEVER store passwords in plain text!
  let hashedNewPassword;
  try {
    // Use bcrypt to hash password with salt rounds = 12
    // Higher salt rounds = more secure but slower
    // 12 is a good balance between security and performance
    hashedNewPassword = await bcrypt.hash(newPassword, 12);
  } catch (err) {
    // If hashing fails, return 500 error
    const error = new HttpError(
      "Could not update password, please try again",
      500
    );
    return next(error);
  }

  // Update user's password field with the new hashed password
  // We replace the old hash with the new hash
  user.password = hashedNewPassword;

  try {
    // Save updated user document to MongoDB
    // This persists the password change to the database
    await user.save();
  } catch (err) {
    // If database save fails, return 500 error
    // The password hasn't been changed in this case
    return next(
      new HttpError("Password update failed, please try again.", 500)
    );
  }

  // Send success response
  // Status 200 = OK, password has been successfully changed
  res.status(200).json({ message: "Password updated successfully!" });
};

/**
 * Updates user profile information (name, region, image)
 * 
 * @purpose Endpoint for users to update their profile details
 * @validates Validates input format through express-validator
 * @imageHandling Supports profile image upload, deletes old image when replaced
 * @body userId, name (optional), region (optional)
 * @file Profile image file (optional, handled by multer middleware)
 * @returns JSON response confirming profile update
 */
const profileUpdate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Validate request data using express-validator middleware rules
  // Checks if required fields are present and properly formatted
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Return 422 if validation fails (invalid data format)
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  // Extract profile fields from request body
  // name: User's display name (optional - can be undefined)
  // region: User's location/region (optional - can be undefined)
  // userId: ID of user being updated (required)
  const { name, region, userId } = req.body;
  
  // Initialize variable to hold user document
  let user;
  try {
    // Find user by their ID in MongoDB
    user = await User.findById(userId);
  } catch (err) {
    // Database query failed - return 500 error
    return next(new HttpError("Profile update failed, please try again.", 500));
  }

  // Check if user exists in database
  if (!user) {
    // User not found - return 404 error
    return next(new HttpError("User not found.", 404));
  }

  // Update name only if provided (name || user.name means: use new name if provided, otherwise keep old name)
  // This allows partial updates - user can update just name, just region, or both
  user.name = name || user.name;
  
  // Update region only if provided (same logic as name)
  user.region = region || user.region;
  
  // Handle profile image update
  // Check if a new image file was uploaded via multer middleware
  const nextImagePath = req.file
    ? getPublicImagePathFromFile(req.file) // If file uploaded, get its public URL path
    : user.image; // If no file, keep existing image path
  
  // Store the old image path so we can delete it later
  // This is important to avoid filling up disk space with orphaned images
  const previousImagePath = user.image;
  
  // Update user's image path to the new one (or keep same if no upload)
  user.image = nextImagePath;

  try {
    // Save all profile updates to MongoDB
    // This persists changes to name, region, and image path
    await user.save();
  } catch (err) {
    // Database save failed - return 500 error
    // No changes have been persisted in this case
    return next(new HttpError("Profile update failed, please try again.", 500));
  }

  // Clean up old profile image if it was replaced
  // Only delete if:
  // 1. A new file was uploaded (req.file exists)
  // 2. User had a previous image (previousImagePath exists)
  // 3. The new path is different from old path (image actually changed)
  if (req.file && previousImagePath && previousImagePath !== nextImagePath) {
    try {
      // Delete the old image file from the file system
      // This prevents accumulation of unused image files
      await deletePublicImageFile(previousImagePath);
    } catch (err) {
      // If image deletion fails, still report success
      // The profile WAS updated, just the old image wasn't cleaned up
      // This is not critical enough to fail the entire request
      return next(
        new HttpError(
          "Profile updated, but removing the previous image failed.",
          500
        )
      );
    }
  }

  // Send success response
  // Status 200 = OK, profile has been successfully updated
  res.status(200).json({ message: "Profile updated successfully!" });
};

// Configuration constant: Number of days of history to retrieve
// Set to 3 days - can be adjusted for more/less history
// Higher values = more data but slower queries
const CHARGING_HISTORY_LOOKBACK_DAYS = 3;

/**
 * Retrieves the user's charging history for recent days
 * 
 * @purpose Endpoint to fetch user's past charging sessions
 * @authentication Requires active session with user ID
 * @timeRange Fetches history for last 3 days (configurable via CHARGING_HISTORY_LOOKBACK_DAYS)
 * @returns JSON response with array of charging history records
 */
const getChargingHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Extract user ID from active session
  const userId = req.session?.user?.id;

  // Check if user is authenticated
  // Only logged-in users can view their charging history
  if (!userId) {
    return next(new HttpError("Not authenticated.", 401));
  }

  // Calculate time range for history lookup (last N days)
  // Date.now() = current timestamp in milliseconds
  // CHARGING_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000 = N days in milliseconds
  // Subtract to get timestamp from N days ago
  const since = new Date(
    Date.now() - CHARGING_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );

  // Initialize variable to hold charging history data
  let history;
  try {
    // Call service function to fetch history from database
    // This queries ChargingHistory collection for records where:
    // - user matches userId
    // - createdAt >= since (last 3 days)
    // Returns array of charging session records
    history = await fetchChargingHistoryForUser(userId, since);
  } catch (err) {
    // If database query fails, return 500 error
    return next(
      new HttpError(
        "Fetching charging history failed, please try again later.",
        500
      )
    );
  }

  // Send successful response with history array
  // Status 200 = OK
  // history contains all charging sessions from the last N days
  res.status(200).json({ history });
};

export {
  passwordUpdate,
  profileUpdate,
  getProfile,
  getChargingHistory,
};
