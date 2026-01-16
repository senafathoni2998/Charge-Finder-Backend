// const mongoose = require("mongoose");
import { Schema, model, Types } from "mongoose";

const vehicleSchema = new Schema({
  name: { type: String, required: true },
  connector_type: { type: [String], required: true },
  min_power: { type: Number, required: true },
  active: { type: Boolean, default: false },
  chargingStatus: {
    type: String,
    enum: ["IDLE", "CHARGING"],
    default: "IDLE",
  },
  owner: { type: Types.ObjectId, ref: "User", required: true },
});

export default model("Vehicle", vehicleSchema);
