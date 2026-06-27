// 🔑 MUST BE FIRST — no imports above this
import dotenv from "dotenv";
dotenv.config();

// ---- now safe to import everything else ----
import type { Request, Response, NextFunction } from "express";

import express from "express";
import bodyParser from "body-parser";
import http from "http";
import mongoose from "mongoose";

import { connectRedis } from "./session/redis";
import sessionMiddleware from "./session/session";
import { authMiddleware } from "./middleware/authMiddleware";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { initChargingProgressWebSocketServer } from "./realtime/charging-progress";
import { getStationById, getStations } from "./controllers/station-controllers";
import vehicle from "./models/vehicle";
import { ensureAdminUser } from "./startup/ensure-admin";
import { ensureStationsSeeded } from "./startup/ensure-stations";
import { ensureDemoData } from "./startup/ensure-demo-data";
import { ensureVehicleBatteryDefaults } from "./services/vehicle-battery-service";
import { notFoundHandler, errorHandler } from "./middleware/error-handler";
import { IMAGE_PUBLIC_ROOT, IMAGE_UPLOAD_ROOT } from "./utils/image-paths";
import { buildMongoUri } from "./utils/mongo-uri";
import { config } from "./config";
import { logger } from "./logger";
const authRoutes = require("./routes/auth-routes");
const adminRoutes = require("./routes/admin-routes");
const profileRoutes = require("./routes/profile-routes");
const vehicleRoutes = require("./routes/vehicle-routes");
const stationRoutes = require("./routes/station-routes");

const app = express();
const server = http.createServer(app);

app.use(bodyParser.json({ limit: "100kb" }));

// Baseline security response headers (helmet-equivalent, no extra dependency).
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (config.isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

app.use(`/${IMAGE_PUBLIC_ROOT}`, express.static(IMAGE_UPLOAD_ROOT));

app.set("trust proxy", 1);
// ✅ session middleware now sees SESSION_SECRET
app.use(sessionMiddleware);

initChargingProgressWebSocketServer(server, sessionMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    ...config.corsOrigins,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  // Only set CORS headers when the origin is explicitly allowlisted (fail closed,
  // regardless of NODE_ENV). Localhost dev origins are included in allowedOrigins above.
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");

    const requestHeaders = req.headers["access-control-request-headers"];
    res.setHeader(
      "Access-Control-Allow-Headers",
      typeof requestHeaders === "string"
        ? requestHeaders
        : "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
  }

  if (req.method === "OPTIONS") {
    if (origin && allowedOrigins.includes(origin)) {
      return res.sendStatus(204);
    }
    // Origin not allowed - reject preflight
    return res.status(403).json({ message: "Origin not allowed" });
  }

  next();
});

// Lightweight liveness probe (no auth, no DB) for load balancers / container healthchecks.
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api", rateLimitMiddleware);

app.use("/api/auth", authRoutes);

// Public stations list (no login required).
app.get("/api/stations", getStations);
app.get("/api/stations/:stationId", getStationById);

// Protect everything below
app.use(authMiddleware);

app.use("/api/admin", adminRoutes);

app.use("/api/profile", profileRoutes);

app.use("/api/vehicles", vehicleRoutes);

app.use("/api/stations", stationRoutes);

app.use(notFoundHandler);

app.use(errorHandler);

mongoose
  .connect(buildMongoUri())
  .then(() => {
    connectRedis().then(async () => {
      logger.info("Connected to MongoDB");
      await ensureAdminUser();
      await ensureStationsSeeded();
      await ensureDemoData();
      try {
        await ensureVehicleBatteryDefaults();
      } catch (err) {
        logger.error({ err }, "Failed to init vehicle batteries");
      }
      server.listen(config.port, () => {
        logger.info(`Server is running on port ${config.port}`);
      });
    });
  })
  .catch((err: Error) => {
    logger.error({ err }, "Database connection failed");
  });
