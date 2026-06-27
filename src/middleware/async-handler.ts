import type { Request, Response, NextFunction } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * Wraps an async route handler so any thrown error (or rejected promise) is
 * forwarded to Express's error middleware via next(), removing the repetitive
 * try/catch + next(error) boilerplate from controllers.
 *
 *   router.get("/", asyncHandler(async (req, res) => { ... throw new NotFoundError() }));
 */
export const asyncHandler =
  (handler: AsyncRequestHandler) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next);
