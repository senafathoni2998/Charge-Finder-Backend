import { Schema, model, Types } from "mongoose";

const chargingTicketSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    station: { type: Types.ObjectId, ref: "Station", required: true },
    vehicle: { type: Types.ObjectId, ref: "Vehicle" },
    connectorType: { type: String, enum: ["CCS2", "Type2", "CHAdeMO"] },
    chargingSpeed: {
      type: String,
      enum: ["NORMAL", "FAST", "ULTRA_FAST"],
      default: "NORMAL",
    },
    ticketKwh: { type: Number, min: 0 },
    targetBatteryPercent: { type: Number, min: 0, max: 100 },
    // Optional "notify me at this battery %" threshold (1–99). When the live
    // batteryPercentage crosses it during charging, the progress timer emits a
    // one-shot "target-reached" WebSocket event. notifyAtReachedAt is the once-only
    // guard: it's null until the notification is claimed/sent, then a timestamp.
    notifyAtPercent: { type: Number, min: 1, max: 99, default: null },
    notifyAtReachedAt: { type: Date, default: null },
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
    chargingDurationMs: { type: Number, min: 0 },
    startingBatteryPercent: { type: Number, min: 0, max: 100 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    // True once this ticket has reserved a physical connector port (set when
    // charging starts). Port release on completion/cancel is gated on this so we
    // never free a port a ticket never reserved.
    portReserved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Hot paths: "active ticket(s) for this user (optionally at this station)".
chargingTicketSchema.index({ user: 1, status: 1, chargingStatus: 1 });
chargingTicketSchema.index({ user: 1, station: 1, chargingStatus: 1 });
chargingTicketSchema.index({ station: 1 });

export default model("ChargingTicket", chargingTicketSchema);
