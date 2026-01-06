// const mongoose = require("mongoose");
import { Schema, model, Types } from "mongoose";

const vehicleSchema = new Schema({
  name: { type: String, required: true },
  connector_type: { type: [String], required: true },
  min_power: { type: Number, required: true },
  owner: { type: Types.ObjectId, ref: "User", required: true },
});

export default model("Vehicle", vehicleSchema);
