import type { Request, Response, NextFunction } from "express";
import HttpError from "../models/http-error";

import User from "../models/user";
import { getPublicImagePathFromFile } from "../utils/image-paths";
import { config } from "../config";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");

/**
 * Registers a new user account
 *
 * @purpose Public endpoint for new users to create an account
 * @validates Checks for duplicate email addresses before registration
 * @security Hashes password with bcrypt (12 salt rounds) before storing
 * @authentication Generates JWT token and creates session for immediate login after signup
 * @imageHandling Supports optional profile image upload during registration
 * @body name, email, password, region (optional)
 * @file Profile image file (optional, handled by multer middleware)
 * @returns JSON response with user details and JWT token (password excluded)
 */
const signup = async (req: Request, res: Response, next: NextFunction) => {
  // Check if signup is disabled via environment variable
  if (config.disableSignup) {
    return next(
      new HttpError("Service unavailable. User registration is currently disabled.", 503),
    );
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422),
    );
  }
  const { name, email, password, region } = req.body;

  // Check if user with this email already exists
  let existingUser;
  try {
    existingUser = await User.findOne({ email });
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again.", 500));
  }

  if (existingUser) {
    return next(
      new HttpError("User exists already, please login instead.", 422),
    );
  }

  // Hash password for secure storage
  let hashedPassword;

  try {
    hashedPassword = await bcrypt.hash(password, 12);
  } catch (err) {
    const error = new HttpError("Could not create user, please try again", 500);
    return next(error);
  }

  let newUser = new User({
    name,
    email,
    password: hashedPassword,
    region: region || "",
    role: "user",
    image: req.file ? getPublicImagePathFromFile(req.file) : undefined,
  });

  try {
    await newUser.save();
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again 1.", 500));
  }

  // Generate JWT token for authentication
  let token;
  try {
    token = jwt.sign(
      { userId: newUser.id, email: newUser.email, name: newUser.name },
      config.jwtSecret,
      { expiresIn: "1d" },
    );
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again 2.", 500));
  }

  const { password: _, ...userWithoutPassword } = newUser.toObject({
    getters: true,
  });

  const userData = { ...userWithoutPassword, token };

  // Create session for the new user
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ message: "Session error" });

    req.session.user = {
      id: newUser.id,
      username: newUser.name,
      role: newUser.role ?? "user",
    };

    res
      .status(201)
      .json({ message: "User created successfully!", user: userData });
  });

  //   res
  //     .status(201)
  //     .json({ message: "User created successfully!", user: userData });
};

/**
 * Creates a new admin user account
 *
 * @purpose Internal/protected endpoint to create administrator accounts
 * @validates Checks for duplicate email addresses before creation
 * @security Hashes password with bcrypt (12 salt rounds), sets role to 'admin'
 * @imageHandling Supports optional profile image upload during admin creation
 * @body name, email, password, region (optional)
 * @file Profile image file (optional, handled by multer middleware)
 * @returns JSON response with admin user details (password excluded)
 * @note Does NOT create session or token (typically used for seeding or admin operations)
 */
const createAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422),
    );
  }

  const { name, email, password, region } = req.body;

  // Check if user with this email already exists
  let existingUser;
  try {
    existingUser = await User.findOne({ email });
  } catch (err) {
    return next(new HttpError("Creating admin failed, please try again.", 500));
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
      new HttpError("Could not create admin, please try again.", 500),
    );
  }

  const newAdmin = new User({
    name,
    email,
    password: hashedPassword,
    region: region || "",
    role: "admin",
    image: req.file ? getPublicImagePathFromFile(req.file) : undefined,
  });

  try {
    await newAdmin.save();
  } catch (err) {
    return next(new HttpError("Creating admin failed, please try again.", 500));
  }

  const { password: _, ...userWithoutPassword } = newAdmin.toObject({
    getters: true,
  });

  res.status(201).json({
    message: "Admin created successfully!",
    user: userWithoutPassword,
  });
};

/**
 * Authenticates a user and creates a session
 *
 * @purpose Public endpoint for existing users to log into their account
 * @validates Verifies email format and password through express-validator
 * @security Compares provided password with hashed password using bcrypt
 * @authentication Generates JWT token and regenerates session on successful login
 * @body email, password
 * @returns JSON response with user details and JWT token (password excluded)
 */
const login = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // If validation fails, forward a 422 error to the error handler
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422),
    );
  }

  const { email, password } = req.body;

  let identifiedUser;
  try {
    // Find the user by email
    identifiedUser = await User.findOne({ email: email });
  } catch (err) {
    const error = new HttpError(
      "Logging in failed, please try again later.",
      500,
    );
    return next(error);
  }

  //* If user is not found or password does not match, forward a 401 error
  if (!identifiedUser) {
    return next(
      new HttpError("Invalid credentials, could not log you in.", 401),
    );
  }

  // Compare the provided password with the hashed password stored in the database
  let isValidPassword = false;
  try {
    // bcrypt.compare returns true if the password matches, false otherwise
    isValidPassword = await bcrypt.compare(password, identifiedUser.password);
  } catch (err) {
    // If an error occurs during password comparison, forward a 500 error
    const error = new HttpError(
      "Could not log you in, please check your credentials and try again",
      500,
    );
    return next(error);
  }

  // If password does not match, forward a 401 error (unauthorized)
  if (!isValidPassword) {
    return next(
      new HttpError("Invalid credentials, could not log you in.", 401),
    );
  }

  // Generate JWT token for authenticated session
  let token;
  try {
    token = jwt.sign(
      {
        userId: identifiedUser.id,
        email: identifiedUser.email,
        name: identifiedUser.name,
      },
      config.jwtSecret,
      { expiresIn: "1d" },
    );
  } catch (err) {
    const error = new HttpError("Could not log you in, please try again", 500);
    return next(error);
  }

  //* Exclude password from the user object before sending the response
  const { password: _, ...userWithoutPassword } = identifiedUser.toObject({
    getters: true,
  });

  const userData = { id: identifiedUser.id, ...userWithoutPassword, token };

  // Regenerate session for security and store user info
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ message: "Session error" });

    req.session.user = {
      id: userData.id,
      username: userData.name,
      role: identifiedUser.role ?? "user",
    };

    req.session.save((err) => {
      if (err) return next(new HttpError("Session save error", 500));

      return res.status(200).json({
        message: "Logged in successfully!",
        user: userData,
      });
    });
  });

  //* Respond with success message and user data (without password)
  // res.status(200).json({ message: "Logged in successfully!", user: userData });
};

/**
 * Logs out a user by destroying their session
 *
 * @purpose Endpoint to end user's authenticated session
 * @security Destroys server-side session and clears session cookie
 * @returns JSON response confirming logout
 * @note Client should also delete JWT token from local storage
 */
const logout = async (req: Request, res: Response, next: NextFunction) => {
  // Destroy session and clear cookie
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Logout failed" });

    res.clearCookie("sid");
    res.status(200).json({ message: "Logged out" });
  });
};

/**
 * Retrieves current session information
 *
 * @purpose Endpoint to check if user is logged in and get session details
 * @returns JSON response with session ID, user info, and login status
 * @note Used by frontend to restore authentication state on page reload
 */
const getSession = (req: Request, res: Response) => {
  const sessionUser = req.session?.user ?? null;
  res.status(200).json({
    sessionId: req.sessionID,
    user: sessionUser,
    isLoggedIn: Boolean(sessionUser),
  });
};

/**
 * Helper function to extract user from session
 *
 * @purpose Utility to get session user data from request object
 * @param req Express request object with session
 * @returns User object from session or null if not logged in
 * @note Internal helper function (not exported as route handler)
 */
const getSessionUser = (req: Request) => {
  return req.session?.user || null;
};

export { signup, login, logout, createAdmin, getSession };
