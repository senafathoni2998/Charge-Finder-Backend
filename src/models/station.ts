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
});

export default model("Station", stationSchema);
