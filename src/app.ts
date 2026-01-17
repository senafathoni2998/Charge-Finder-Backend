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
import { initChargingProgressWebSocketServer } from "./realtime/charging-progress";
import { getStationById, getStations } from "./controllers/station-controllers";
import vehicle from "./models/vehicle";
import { ensureAdminUser } from "./startup/ensure-admin";
import { ensureStationsSeeded } from "./startup/ensure-stations";
import { ensureVehicleBatteryDefaults } from "./services/vehicle-battery-service";
import HttpError from "./models/http-error";
import { IMAGE_PUBLIC_ROOT, IMAGE_UPLOAD_ROOT } from "./utils/image-paths";
const authRoutes = require("./routes/auth-routes");
const adminRoutes = require("./routes/admin-routes");
const profileRoutes = require("./routes/profile-routes");
const vehicleRoutes = require("./routes/vehicle-routes");
const stationRoutes = require("./routes/station-routes");

const app = express();
const server = http.createServer(app);

app.use(bodyParser.json());

app.use(`/${IMAGE_PUBLIC_ROOT}`, express.static(IMAGE_UPLOAD_ROOT));

// ✅ session middleware now sees SESSION_SECRET
app.use(sessionMiddleware);

initChargingProgressWebSocketServer(server, sessionMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    ...(process.env.CORS_ORIGINS?.split(",") ?? []),
    process.env.CORS_ORIGIN ?? "",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  const isDev = process.env.NODE_ENV !== "production";

  if (origin && (isDev || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const requestHeaders = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    typeof requestHeaders === "string"
      ? requestHeaders
      : "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

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

app.use((req: Request, res: Response, next: NextFunction) => {
  const error = new HttpError("Could not find this route.", 404);
  throw error;
});

app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }
  console.log("ERROR CODE", error);
  res.status(error.code || 500);
  res.json({ message: error.message || "An unknown error occurred!" });
});

mongoose
  .connect(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/?appName=${process.env.DB_NAME}`
  )
  .then(() => {
    connectRedis().then(async () => {
      console.log("✅ Connected to MongoDB");
      await ensureAdminUser();
      await ensureStationsSeeded();
      try {
        await ensureVehicleBatteryDefaults();
      } catch (err) {
        console.error("Failed to init vehicle batteries:", err);
      }
      server.listen(5000, () => {
        console.log("Server is running on port 5000");
      });
    });
  })
  .catch((err: Error) => {
    console.error("Database connection failed:", err);
  });
