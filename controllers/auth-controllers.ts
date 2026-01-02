import type { Request, Response, NextFunction } from "express";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");

const HttpError = require("../models/http-error");
const User = require("../models/user");

const signup = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }
  const { name, email, password } = req.body;

  let existingUser;
  try {
    existingUser = await User.findOne({ email });
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again.", 500));
  }

  if (existingUser) {
    return next(
      new HttpError("User exists already, please login instead.", 422)
    );
  }

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
  });

  try {
    await newUser.save();
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again.", 500));
  }

  let token;
  try {
    token = jwt.sign(
      { userId: newUser.id, email: newUser.email, name: newUser.email },
      process.env.SECRET_KEY,
      { expiresIn: "1h" }
    );
  } catch (err) {
    return next(new HttpError("Signing up failed, please try again.", 500));
  }

  const { password: _, ...userWithoutPassword } = newUser.toObject({
    getters: true,
  });

  const userData = { ...userWithoutPassword, token };

  res
    .status(201)
    .json({ message: "User created successfully!", user: userData });
};

const login = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // If validation fails, forward a 422 error to the error handler
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
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
      500
    );
    return next(error);
  }

  //* If user is not found or password does not match, forward a 401 error
  if (!identifiedUser) {
    return next(
      new HttpError("Invalid credentials, could not log you in.", 401)
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
      500
    );
    return next(error);
  }

  // If password does not match, forward a 401 error (unauthorized)
  if (!isValidPassword) {
    return next(
      new HttpError("Invalid credentials, could not log you in.", 401)
    );
  }

  let token;
  try {
    token = jwt.sign(
      {
        userId: identifiedUser.id,
        email: identifiedUser.email,
        name: identifiedUser.name,
      },
      process.env.SECRET_KEY,
      { expiresIn: "1d" }
    );
  } catch (err) {
    const error = new HttpError("Could not log you in, please try again", 500);
    return next(error);
  }

  //* Exclude password from the user object before sending the response
  const { password: _, ...userWithoutPassword } = identifiedUser.toObject({
    getters: true,
  });

  const userData = { ...userWithoutPassword, token };

  //* Respond with success message and user data (without password)
  res.status(200).json({ message: "Logged in successfully!", user: userData });
};

const logout = async (req: Request, res: Response, next: NextFunction) => {
  // Since JWT is stateless, logout can be handled on the client side by deleting the token.
  // Optionally, you can implement token blacklisting on the server side if needed.
  res.status(200).json({ message: "Logged out successfully!" });
};

exports.signup = signup;
exports.login = login;
exports.logout = logout;