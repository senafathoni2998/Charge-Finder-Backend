// const mongoose = require("mongoose");
import { Schema, model, Types } from "mongoose";

const vehicleSchema = new Schema({
  name: { type: String, required: true },
  connector_type: { type: [String], required: true },
  min_power: { type: Number, required: true },
  active: { type: Boolean, default: false },
  batteryPercent: { type: Number, min: 0, max: 100, default: 100 },
  batteryCapacity: { type: Number, min: 0 },
  lastBatteryUpdatedAt: { type: Date, default: Date.now },
  chargingStatus: {
    type: String,
    enum: ["IDLE", "CHARGING"],
    default: "IDLE",
  },
  batteryStatus: {
    type: String,
    enum: ["FULL", "HIGH", "MEDIUM", "LOW", "CRITICAL"],
    default: "FULL",
  },
  owner: { type: Types.ObjectId, ref: "User", required: true },
});

// Hot path: list / count a user's vehicles, and find their active vehicle.
vehicleSchema.index({ owner: 1 });
vehicleSchema.index({ owner: 1, active: 1 });

export default model("Vehicle", vehicleSchema);
