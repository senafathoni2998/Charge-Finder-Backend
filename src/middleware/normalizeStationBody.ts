import type { Request, Response, NextFunction } from "express";

// The station create/update endpoints accept BOTH application/json (the classic
// contract) and multipart/form-data (when a feature image is uploaded). Under
// multipart, multer only populates text fields as strings, so the structured
// fields arrive JSON-encoded and lat/lng arrive as strings. This middleware
// normalizes those back to their expected shapes BEFORE express-validator and the
// controllers run, so both transports flow through identical downstream logic.
//
// It is a strict no-op for JSON requests: every branch is guarded on the value
// still being a string, which it never is once bodyParser.json has parsed the body.

const JSON_FIELDS = ["connectors", "pricing", "amenities", "photos"] as const;
const NUMBER_FIELDS = ["lat", "lng"] as const;
const BOOLEAN_FIELDS = ["removeFeaturedImage"] as const;

export const normalizeStationBody = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return next();
  }

  for (const field of JSON_FIELDS) {
    const value = body[field];
    if (typeof value === "string" && value.trim() !== "") {
      try {
        body[field] = JSON.parse(value);
      } catch {
        // Leave the raw string in place — express-validator's array/object checks
        // will reject it with a 422, matching the JSON path's error behavior.
      }
    }
  }

  for (const field of NUMBER_FIELDS) {
    const value = body[field];
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        body[field] = parsed;
      }
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = body[field];
    if (typeof value === "string") {
      body[field] = value === "true" || value === "1";
    }
  }

  next();
};

export default normalizeStationBody;
