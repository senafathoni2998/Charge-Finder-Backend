import { Schema, model } from "mongoose";

export type Availability = "AVAILABLE" | "BUSY" | "OFFLINE";
export type ConnectorType = "CCS2" | "Type2" | "CHAdeMO";

export type Connector = {
  type: ConnectorType;
  powerKW: number;
  ports: number; // total ports of this connector type
  availablePorts: number; // currently available ports
};

export type StationPhoto = {
  label: string;
  gradient: string;
};

export type StationPricing = {
  currency: string;
  perKwh: number;
  fastPerKwh?: number;
  ultraFastPerKwh?: number;
  perMinute?: number;
  parkingFee?: string;
};

export type Station = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  connectors: Connector[];
  status: Availability;
  lastUpdatedISO: string;
  photos: StationPhoto[];
  pricing: StationPricing;
  amenities: string[];
  notes?: string;
  location?: { type: "Point"; coordinates: [number, number] };
};

const connectorSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["CCS2", "Type2", "CHAdeMO"],
      required: true,
    },
    powerKW: { type: Number, required: true },
    ports: { type: Number, required: true },
    availablePorts: { type: Number, required: true },
  },
  { _id: false }
);

const stationPhotoSchema = new Schema(
  {
    label: { type: String, required: true },
    gradient: { type: String, required: true },
  },
  { _id: false }
);

const stationPricingSchema = new Schema(
  {
    currency: { type: String, required: true },
    perKwh: { type: Number, required: true },
    fastPerKwh: { type: Number, min: 0 },
    ultraFastPerKwh: { type: Number, min: 0 },
    perMinute: { type: Number },
    parkingFee: { type: String },
  },
  { _id: false }
);

// GeoJSON Point sub-schema (defined separately so the parent schema's TS type
// inference stays clean and the `type` discriminator isn't misread).
const pointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  { _id: false }
);

const stationSchema = new Schema({
  name: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  address: { type: String, required: true },
  connectors: { type: [connectorSchema], required: true },
  status: { type: String, enum: ["AVAILABLE", "BUSY", "OFFLINE"], required: true },
  lastUpdatedISO: { type: String, required: true },
  photos: { type: [stationPhotoSchema], default: [], required: true },
  pricing: { type: stationPricingSchema, required: true },
  amenities: { type: [String], default: [], required: true },
  notes: { type: String },
  // GeoJSON point for 2dsphere geo-queries ($geoNear). Kept in sync with lat/lng.
  location: { type: pointSchema, index: "2dsphere", default: undefined },
});

// The GeoJSON `location` is populated wherever stations are written:
//   - admin create/update controllers (station-admin.ts) via toGeoPoint(lat, lng)
//   - the seed pipeline (ensure-stations.ts)
//   - the one-off backfill script (scripts/backfill-station-location.ts)
// (A save hook is intentionally avoided — it would also need to cover insertMany,
//  and Mongoose's inferred Schema type doesn't expose .pre cleanly here.)
export const toGeoPoint = (
  lat: unknown,
  lng: unknown
): { type: "Point"; coordinates: [number, number] } | undefined => {
  if (typeof lat === "number" && typeof lng === "number") {
    return { type: "Point", coordinates: [lng, lat] };
  }
  return undefined;
};

export default model("Station", stationSchema);
