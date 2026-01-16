import { Schema, model, Types } from "mongoose";

const chargingTicketSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    station: { type: Types.ObjectId, ref: "Station", required: true },
    vehicle: { type: Types.ObjectId, ref: "Vehicle" },
    connectorType: { type: String, enum: ["CCS2", "Type2", "CHAdeMO"] },
    status: {
      type: String,
      enum: ["REQUESTED", "PAID", "CANCELLED"],
      default: "REQUESTED",
    },
    chargingStatus: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"],
      default: "NOT_STARTED",
    },
    progressPercent: { type: Number, min: 0, max: 100, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export default model("ChargingTicket", chargingTicketSchema);
