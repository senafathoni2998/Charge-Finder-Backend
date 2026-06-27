import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../../../models/http-error";
import ChargingTicket from "../../../models/charging-ticket";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
} from "../../../realtime/charging-progress";
import {
  appendChargingBatteryPercentage,
  buildChargingTicketPayload,
  finalizeChargingTicket,
} from "../../../services/charging-ticket-service";
import { cancelCharging } from "./cancel-charging";

const completeCharging = async (
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

  if (req.body?.cancel === true) {
    return cancelCharging(req, res, next);
  }

  const { stationId } = req.body;
  const sessionUserId = req.user?.id;

  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let ticket;
  try {
    ticket = await ChargingTicket.findOne({
      station: stationId,
      user: sessionUserId,
      status: { $in: ["REQUESTED", "PAID"] },
    }).sort({ createdAt: -1 });
  } catch (err) {
    return next(
      new HttpError("Completing charging failed, please try again.", 500)
    );
  }

  if (!ticket) {
    return next(new HttpError("Active ticket not found.", 404));
  }

  const completedAt = new Date();
  const completedPayload = await buildChargingTicketPayload(ticket, {
    userId: sessionUserId,
    stationId,
  });
  const ticketSnapshot = appendChargingBatteryPercentage(
    {
      ...(completedPayload ?? ticket.toObject({ getters: true })),
      progressPercent: 100,
      chargingStatus: "COMPLETED",
      completedAt,
    },
    100
  );
  const completedBatteryPercentage = (
    ticketSnapshot as { batteryPercentage?: number }
  ).batteryPercentage;

  try {
    // History + battery are written inside the finalize transaction.
    await finalizeChargingTicket(ticket.id, sessionUserId, {
      ticketSnapshot: ticketSnapshot,
      outcome: "COMPLETED",
      endedAt: completedAt,
      vehicleBatteryPercent:
        typeof completedBatteryPercentage === "number"
          ? completedBatteryPercentage
          : null,
    });
    clearChargingProgressTimer(ticket.id);
  } catch (err) {
    return next(
      new HttpError("Completing charging failed, please try again.", 500)
    );
  }

  broadcastChargingProgress(
    buildChargingProgressKey(sessionUserId, stationId),
    {
      type: "completed",
      ticket: null,
      completedTicket: ticketSnapshot,
    }
  );

  res.status(200).json({
    message: "Charging completed and ticket cleared successfully!",
    completedTicket: ticketSnapshot,
  });
};

export { completeCharging };
