import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../../../models/http-error";
import ChargingTicket from "../../../models/charging-ticket";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../../../realtime/charging-progress";
import {
  appendChargingBatteryPercentage,
  buildChargingTicketPayload,
  calculateChargingProgressPercent,
  finalizeChargingTicket,
  resolveChargingDurationMsForTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
} from "../../../services/charging-ticket-service";

/**
 * Updates the progress of an ongoing charging session
 * 
 * @purpose Endpoint to refresh charging progress (typically called periodically)
 * @behavior Calculates current progress, updates vehicle battery percentage
 * @autoCompletion If progress reaches 100%, automatically finalizes the session
 * @realtime Broadcasts progress updates via WebSocket to connected clients
 * @body stationId
 * @returns JSON response with updated ticket details or completion confirmation
 */
const updateChargingProgress = async (
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
      new HttpError("Updating charging progress failed, please try again.", 500)
    );
  }

  if (!ticket) {
    return next(new HttpError("Active ticket not found.", 404));
  }

  ticket.chargingStatus = "IN_PROGRESS";
  if (!ticket.startedAt) {
    ticket.startedAt = new Date();
  }

  const chargingDurationMs = await resolveChargingDurationMsForTicket(ticket);
  const progressPercent = calculateChargingProgressPercent(
    ticket.startedAt,
    Date.now(),
    chargingDurationMs
  );

  if (progressPercent >= 100) {
    const completedAt = new Date();
    const completedPayload = await buildChargingTicketPayload(ticket, {
      userId: sessionUserId,
      stationId,
    });
    const completedTicket = appendChargingBatteryPercentage(
      {
        ...(completedPayload ?? ticket.toObject({ getters: true })),
        progressPercent: 100,
        chargingStatus: "COMPLETED",
        completedAt,
      },
      100
    );
    const completedBatteryPercentage = (
      completedTicket as { batteryPercentage?: number }
    ).batteryPercentage;

    try {
      // History + battery are written inside the finalize transaction.
      await finalizeChargingTicket(ticket.id, sessionUserId, {
        ticketSnapshot: completedTicket,
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
        completedTicket,
      }
    );

    return res.status(200).json({
      message: "Charging completed and ticket cleared successfully!",
    });
  }

  ticket.progressPercent = progressPercent;

  try {
    await ticket.save();
  } catch (err) {
    return next(
      new HttpError("Updating charging progress failed, please try again.", 500)
    );
  }

  const ticketVehicleId =
    typeof ticket.vehicle?.toString === "function"
      ? ticket.vehicle.toString()
      : typeof ticket.vehicle === "string"
      ? ticket.vehicle
      : null;

  try {
    if (ticketVehicleId) {
      await setVehicleChargingStatus(ticketVehicleId, "CHARGING");
    } else {
      await setActiveVehicleChargingStatus(sessionUserId, "CHARGING");
    }
  } catch (err) {
    // Best-effort: charging should not fail due to vehicle status update.
  }

  const ticketPayload = await buildChargingTicketPayload(ticket, {
    userId: sessionUserId,
    stationId,
  });

  broadcastChargingProgress(
    buildChargingProgressKey(sessionUserId, stationId),
    {
      type: "progress",
      ticket: ticketPayload,
    }
  );

  ensureChargingProgressTimer(ticket);

  res.status(200).json({
    message: "Charging progress updated successfully!",
    ticket: ticketPayload,
  });
};

export { updateChargingProgress };
