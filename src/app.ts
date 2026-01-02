// 🔑 MUST BE FIRST — no imports above this
import dotenv from "dotenv";
dotenv.config();

// ---- now safe to import everything else ----
import type { Request, Response, NextFunction } from "express";

import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";

import { connectRedis } from "./session/redis";
import sessionMiddleware from "./session/session";
import { authMiddleware } from "./middleware/authMiddleware";

const HttpError = require("./models/http-error");
const authRoutes = require("./routes/auth-routes");

const app = express();

app.use(bodyParser.json());

// ✅ session middleware now sees SESSION_SECRET
app.use(sessionMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
  next();
});

app.use("/api/auth", authRoutes);

// Protect everything below
app.use(authMiddleware);

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
    connectRedis().then(() => {
      console.log("✅ Connected to MongoDB");
      app.listen(5000, () => {
        console.log("Server is running on port 5000");
      });
    });
  })
  .catch((err: Error) => {
    console.error("Database connection failed:", err);
  });
