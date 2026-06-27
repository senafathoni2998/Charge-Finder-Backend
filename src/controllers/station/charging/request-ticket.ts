import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../../models/http-error";
import Station from "../../../models/station";
import User from "../../../models/user";
import ChargingTicket from "../../../models/charging-ticket";
import Vehicle from "../../../models/vehicle";
import { buildChargingTicketPayload } from "../../../services/charging-ticket-service";
import {
  isChargingSpeedSupported,
  resolveChargingSpeed,
} from "../station-charging-helpers";

/**
 * Creates a new charging ticket request for a station
 * 
 * @purpose Endpoint for users to request permission to charge at a station
 * @validates Verifies station exists, connector type available, and charging speed supported
 * @authentication Requires active session
 * @transaction Creates ticket and adds to user's tickets list atomically
 * @body stationId, connectorType, vehicleId (optional), chargingSpeed, ticketKwh (optional)
 * @returns JSON response with created ticket details
 * @note This creates a REQUESTED ticket - user must call startCharging to begin
 */
const requestChargingTicket = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { stationId, connectorType, vehicleId, chargingSpeed, ticketKwh } =
    req.body;
  const sessionUserId = req.user?.id;

  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Requesting ticket failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  if (
    typeof connectorType === "string" &&
    !station.connectors.some((connector: { type: string }) => {
      return connector.type === connectorType;
    })
  ) {
    return next(
      new HttpError(
        "Requested connector type is not available at this station.",
        422
      )
    );
  }

  const resolvedChargingSpeed = resolveChargingSpeed(chargingSpeed);
  if (
    !isChargingSpeedSupported(
      station,
      resolvedChargingSpeed,
      typeof connectorType === "string" ? connectorType : null
    )
  ) {
    return next(
      new HttpError(
        "Requested charging speed is not supported at this station.",
        422
      )
    );
  }

  let user;
  try {
    user = await User.findById(sessionUserId);
  } catch (err) {
    return next(
      new HttpError("Requesting ticket failed, please try again.", 500)
    );
  }

  if (!user) {
    return next(new HttpError("User not found.", 404));
  }

  let vehicle = null;
  if (typeof vehicleId === "string") {
    try {
      vehicle = await Vehicle.findOne({ _id: vehicleId, owner: user._id });
    } catch (err) {
      return next(
        new HttpError("Requesting ticket failed, please try again.", 500)
      );
    }

    if (!vehicle) {
      return next(new HttpError("Vehicle not found.", 404));
    }
  }

  const newTicket = new ChargingTicket({
    station: station._id,
    user: user._id,
    connectorType,
    vehicle: vehicle?._id,
    chargingSpeed: resolvedChargingSpeed,
    ticketKwh:
      typeof ticketKwh === "number" && Number.isFinite(ticketKwh)
        ? ticketKwh
        : undefined,
  });

  const sess = await mongoose.startSession();
  try {
    sess.startTransaction();
    await newTicket.save({ session: sess });
    user.tickets.push(newTicket._id);
    await user.save({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    await sess.abortTransaction();
    return next(
      new HttpError("Requesting ticket failed, please try again.", 500)
    );
  } finally {
    sess.endSession();
  }

  const ticketPayload = await buildChargingTicketPayload(newTicket, {
    userId: sessionUserId,
    stationId,
  });

  res.status(201).json({
    message: "Charging ticket requested successfully!",
    ticket: ticketPayload ?? newTicket.toObject({ getters: true }),
  });
};

export { requestChargingTicket };
