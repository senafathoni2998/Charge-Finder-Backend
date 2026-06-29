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
} from "../../../services/charging-ticket-service";

/**
 * Retrieves the active charging ticket for a specific station
 * 
 * @purpose Endpoint to fetch user's current charging session at a station
 * @authentication Requires active session
 * @autoCompletion If charging is complete (100%), automatically finalizes ticket
 * @realtime Ensures charging progress timer is running for in-progress sessions
 * @params stationId - Station ID from URL params
 * @returns JSON response with active ticket or null if none exists
 */
const getActiveTicketForStation = async (
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

  const { stationId } = req.params;
  const sessionUserId = req.user?.id;

  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let activeTicket;
  try {
    activeTicket = await ChargingTicket.findOne({
      station: stationId,
      user: sessionUserId,
      status: { $in: ["REQUESTED", "PAID"] },
    }).sort({ createdAt: -1 });
  } catch (err) {
    return next(
      new HttpError("Fetching ticket failed, please try again.", 500)
    );
  }

  if (
    activeTicket?.chargingStatus === "IN_PROGRESS" &&
    activeTicket.startedAt
  ) {
    const chargingDurationMs = await resolveChargingDurationMsForTicket(
      activeTicket
    );
    const progressPercent = calculateChargingProgressPercent(
      activeTicket.startedAt,
      Date.now(),
      chargingDurationMs
    );

    if (progressPercent >= 100) {
      const completedAt = new Date();
      const completedPayload = await buildChargingTicketPayload(activeTicket, {
        userId: sessionUserId,
        stationId,
      });
      const completedTicket = appendChargingBatteryPercentage(
        {
          ...(completedPayload ?? activeTicket.toObject({ getters: true })),
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
        await finalizeChargingTicket(activeTicket.id, sessionUserId, {
          ticketSnapshot: completedTicket,
          outcome: "COMPLETED",
          endedAt: completedAt,
          vehicleBatteryPercent:
            typeof completedBatteryPercentage === "number"
              ? completedBatteryPercentage
              : null,
        });
        clearChargingProgressTimer(activeTicket.id);
        broadcastChargingProgress(
          buildChargingProgressKey(sessionUserId, stationId),
          {
            type: "completed",
            ticket: null,
            completedTicket,
          }
        );
        activeTicket = null;
      } catch (err) {
        // If completion fails, fall back to returning the ticket.
      }
    } else {
      activeTicket.progressPercent = progressPercent;
      ensureChargingProgressTimer(activeTicket);
    }
  }

  const ticketPayload = activeTicket
    ? await buildChargingTicketPayload(activeTicket, {
        userId: sessionUserId,
        stationId,
      })
    : null;

  res.status(200).json({
    ticket: ticketPayload,
  });
};

export { getActiveTicketForStation };
