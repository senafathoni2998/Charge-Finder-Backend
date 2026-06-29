import { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method === "OPTIONS") {
    return next();
  }

  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Type-safe access
  req.user = req.session.user; // optional if you extend Request
  next();
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const user = req.user ?? req.session?.user;
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  req.user = user;
  next();
}
