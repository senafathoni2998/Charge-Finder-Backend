import type { Request, Response, NextFunction } from "express";

import HttpError from "../models/http-error";
import { NotFoundError } from "../errors";

const isHttpStatus = (value: unknown): value is number =>
  typeof value === "number" && value >= 400 && value <= 599;

/** Terminal middleware for unmatched routes — forwards a 404 to the error handler. */
export const notFoundHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next(new NotFoundError("Could not find this route."));
};

/**
 * Single normalizing error middleware. Maps known error shapes to a proper HTTP
 * status + message and returns a consistent { message } body. Server faults (5xx)
 * are logged; routine client errors (4xx) are not.
 */
export const errorHandler = (
  error: any,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    return next(error);
  }

  let status = 500;
  let message = "An unknown error occurred!";

  if (error instanceof HttpError) {
    status = isHttpStatus(error.code) ? error.code : 500;
    message = error.message || message;
  } else if (error?.name === "ValidationError") {
    // Mongoose document validation failure.
    status = 422;
    message = "Invalid inputs passed, please check your data.";
  } else if (error?.name === "CastError") {
    // Mongoose failed to cast a value (e.g. a malformed ObjectId).
    status = 400;
    message = "Invalid identifier.";
  } else if (error?.code === 11000) {
    // MongoDB duplicate-key violation.
    status = 409;
    message = "A record with that value already exists.";
  } else if (error?.name === "MulterError") {
    // File-upload error (e.g. LIMIT_FILE_SIZE) — has a string `code`, not a status.
    status = 400;
    message = error.message || "File upload error.";
  } else if (isHttpStatus(error?.statusCode)) {
    status = error.statusCode;
    message = error.message || message;
  } else if (isHttpStatus(error?.code)) {
    status = error.code;
    message = error.message || message;
  } else if (error instanceof Error && error.message) {
    message = error.message;
  }

  if (status >= 500) {
    console.error("Unhandled error:", error);
  }

  res.status(status).json({ message });
};
