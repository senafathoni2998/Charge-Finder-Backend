import { Schema, model, Types } from "mongoose";

const chargingTicketSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    station: { type: Types.ObjectId, ref: "Station", required: true },
    connectorType: { type: String, enum: ["CCS2", "Type2", "CHAdeMO"] },
    status: {
      type: String,
      enum: ["REQUESTED", "PAID", "CANCELLED"],
      default: "REQUESTED",
    },
  },
  { timestamps: true }
);

export default model("ChargingTicket", chargingTicketSchema);
