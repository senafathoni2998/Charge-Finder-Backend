import { Schema, model, Types } from "mongoose";

// A saved trip plan. The stops are stored as denormalized snapshots (with an optional
// Station ref) so a saved plan still renders even if a station is later edited/removed.
const geoPointSchema = new Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    label: { type: String },
  },
  { _id: false }
);

const tripStopSchema = new Schema(
  {
    station: { type: Types.ObjectId, ref: "Station" },
    name: { type: String },
    address: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    connectorType: { type: String },
    powerKW: { type: Number },
    distanceFromPrevKm: { type: Number },
    cumulativeKm: { type: Number },
    arrivalBatteryPercent: { type: Number },
    departBatteryPercent: { type: Number },
  },
  { _id: false }
);

const tripSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    vehicle: { type: Types.ObjectId, ref: "Vehicle" },
    name: { type: String, maxlength: 120, trim: true },
    origin: { type: geoPointSchema, required: true },
    destination: { type: geoPointSchema, required: true },

    // Snapshot of the parameters the plan was computed with.
    fullRangeKm: { type: Number, required: true },
    startBatteryPercent: { type: Number },
    bufferPercent: { type: Number },
    chargeToPercent: { type: Number },
    minPowerKW: { type: Number },
    maxDetourKm: { type: Number },
    allowedConnectorTypes: { type: [String], default: [] },

    // Computed summary.
    feasible: { type: Boolean, required: true },
    directDistanceKm: { type: Number },
    totalDistanceKm: { type: Number },
    totalStops: { type: Number, default: 0 },
    stops: { type: [tripStopSchema], default: [] },
  },
  { timestamps: true }
);

// Hot path: a user's saved trips, newest first.
tripSchema.index({ user: 1, createdAt: -1 });

export default model("Trip", tripSchema);
