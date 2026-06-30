import { Schema, model, Types } from "mongoose";

// A reservation holds one port of a given connector type at a station for the window
// [startTime, endTime). Capacity (overlapping ACTIVE reservations < connector.ports)
// is enforced in the controller before a reservation is written — see
// controllers/reservation-controllers.ts. Status stays ACTIVE until cancelled; a
// reservation whose window has elapsed is simply "past" (derived in the payload), so
// no background sweeper is needed — capacity checks filter ACTIVE reservations by time.
export const RESERVATION_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const reservationSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    station: { type: Types.ObjectId, ref: "Station", required: true },
    connectorType: {
      type: String,
      enum: ["CCS2", "Type2", "CHAdeMO"],
      required: true,
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: RESERVATION_STATUSES,
      default: "ACTIVE",
    },
    vehicle: { type: Types.ObjectId, ref: "Vehicle" },
    notes: { type: String, maxlength: 500, trim: true },
  },
  { timestamps: true }
);

// Hot path: capacity/overlap queries for a station+connector within a time window.
reservationSchema.index({
  station: 1,
  connectorType: 1,
  status: 1,
  startTime: 1,
  endTime: 1,
});
// Hot path: a user's reservations, soonest-starting first.
reservationSchema.index({ user: 1, status: 1, startTime: -1 });

export default model("Reservation", reservationSchema);
