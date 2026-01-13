// const mongoose = require("mongoose");
import { Schema, model, Types } from "mongoose";

const userSchema = new Schema({
  name: { type: String, required: true },
  region: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ["admin", "user"], default: "user" },
  vehicles: [{ type: Types.ObjectId, ref: "Vehicle" }],
  tickets: [{ type: Types.ObjectId, ref: "ChargingTicket" }],
});

export default model("User", userSchema);
