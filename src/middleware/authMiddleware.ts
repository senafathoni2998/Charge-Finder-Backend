import { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
    console.log("AUTH CHECK:", {
    cookie: req.headers.cookie,
    sessionID: req.sessionID,
    session: req.session,
  });

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
