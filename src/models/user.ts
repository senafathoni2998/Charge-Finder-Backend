// const mongoose = require("mongoose");
import { Schema, model, Types } from "mongoose";

const userSchema = new Schema({
  name: { type: String, required: true },
  region: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, minlength: 6 },
  vehicles: [{ type: Types.ObjectId, ref: "Vehicle" }],
});

export default model("User", userSchema);
