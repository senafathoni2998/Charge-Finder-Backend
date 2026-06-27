import HttpError from "./models/http-error";

// Semantic HTTP error classes. They extend HttpError (which carries the numeric
// `code` used as the HTTP status), so they flow through the existing error
// middleware AND read clearly at throw sites:
//
//   throw new NotFoundError("Station not found.");   // -> 404
//   throw new ValidationError();                      // -> 422
//
// All are "operational" (expected) errors — distinct from programming errors,
// which surface as generic 500s.

export class BadRequestError extends HttpError {
  constructor(message = "Bad request.") {
    super(message, 400);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized.") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden.") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found.") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict.") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends HttpError {
  constructor(message = "Invalid inputs passed, please check your data.") {
    super(message, 422);
    this.name = "ValidationError";
  }
}

export class InternalError extends HttpError {
  constructor(message = "An unknown error occurred!") {
    super(message, 500);
    this.name = "InternalError";
  }
}

export { default as HttpError } from "./models/http-error";
