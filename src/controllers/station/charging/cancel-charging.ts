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
  calculateChargingProgressPercent,
  finalizeChargingTicket,
  resolveChargingDurationMsForTicket,
} from "../../../services/charging-ticket-service";

/**
 * Cancels an ongoing charging session
 * 
 * @purpose Endpoint for users to stop charging before completion
 * @behavior Releases connector port, updates vehicle status, records history
 * @realtime Stops progress timer and broadcasts cancellation event via WebSocket
 * @body stationId
 * @returns JSON response confirming cancellation
 * @note Marks ticket as CANCELLED and records partial charge in history
 */
const cancelCharging = async (
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
      new HttpError("Cancelling charging failed, please try again.", 500)
    );
  }

  if (!ticket) {
    return next(new HttpError("Active ticket not found.", 404));
  }

  const chargingDurationMs = await resolveChargingDurationMsForTicket(ticket);
  const progressPercent = calculateChargingProgressPercent(
    ticket.startedAt,
    Date.now(),
    chargingDurationMs
  );

  const cancelledAt = new Date();
  const cancelledPayload = await buildChargingTicketPayload(ticket, {
    userId: sessionUserId,
    stationId,
  });
  const cancelledTicket = appendChargingBatteryPercentage(
    {
      ...(cancelledPayload ?? ticket.toObject({ getters: true })),
      progressPercent,
      status: "CANCELLED",
      chargingStatus: "CANCELLED",
      cancelledAt,
    },
    progressPercent
  );
  const cancelledBatteryPercentage = (
    cancelledTicket as { batteryPercentage?: number }
  ).batteryPercentage;

  try {
    // History + battery are written inside the finalize transaction.
    await finalizeChargingTicket(ticket.id, sessionUserId, {
      ticketSnapshot: cancelledTicket,
      outcome: "CANCELLED",
      endedAt: cancelledAt,
      vehicleBatteryPercent:
        typeof cancelledBatteryPercentage === "number"
          ? cancelledBatteryPercentage
          : null,
    });
    clearChargingProgressTimer(ticket.id);
  } catch (err) {
    return next(
      new HttpError("Cancelling charging failed, please try again.", 500)
    );
  }

  broadcastChargingProgress(
    buildChargingProgressKey(sessionUserId, stationId),
    {
      type: "cancelled",
      ticket: null,
      cancelledTicket,
    }
  );

  res.status(200).json({
    message: "Charging cancelled and ticket cleared successfully!",
    cancelledTicket,
  });
};

export { cancelCharging };
