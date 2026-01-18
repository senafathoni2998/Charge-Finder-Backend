import { Schema, model, Types } from "mongoose";

const chargingHistorySchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    ticketId: {
      type: Types.ObjectId,
      ref: "ChargingTicket",
      required: true,
      unique: true,
    },
    station: { type: Types.ObjectId, ref: "Station" },
    stationName: { type: String },
    stationAddress: { type: String },
    vehicle: { type: Types.ObjectId, ref: "Vehicle" },
    vehicleName: { type: String },
    connectorType: { type: String, enum: ["CCS2", "Type2", "CHAdeMO"] },
    chargingSpeed: { type: String, enum: ["NORMAL", "FAST", "ULTRA_FAST"] },
    ticketKwh: { type: Number, min: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date, required: true },
    outcome: { type: String, enum: ["COMPLETED", "CANCELLED"], required: true },
    progressPercent: { type: Number, min: 0, max: 100 },
    startingBatteryPercent: { type: Number, min: 0, max: 100 },
    batteryPercentage: { type: Number, min: 0, max: 100 },
    chargingDurationMs: { type: Number, min: 0 },
  },
  { timestamps: true }
);

export default model("ChargingHistory", chargingHistorySchema);
