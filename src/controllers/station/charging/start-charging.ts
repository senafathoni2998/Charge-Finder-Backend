import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../../../models/http-error";
import Station from "../../../models/station";
import ChargingTicket from "../../../models/charging-ticket";
import Vehicle from "../../../models/vehicle";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../../../realtime/charging-progress";
import {
  adjustStationConnectorAvailability,
  buildChargingTicketPayload,
  calculateChargingDurationMs,
  setVehicleChargingStatus,
} from "../../../services/charging-ticket-service";
import {
  isChargingSpeedSupported,
  resolveChargingSpeed,
} from "../station-charging-helpers";
import { resolveConnectorType } from "./shared";

/**
 * Starts a charging session at a station
 * 
 * @purpose Endpoint to begin charging after ticket is requested/paid
 * @validation Checks for conflicting sessions, available connectors, and vehicle requirements
 * @behavior Reserves connector port, calculates charging duration, updates vehicle status
 * @realtime Starts progress timer and broadcasts charging started event via WebSocket
 * @body stationId, connectorType (optional), vehicleId (optional)
 * @returns JSON response with started charging ticket details
 * @note Automatically uses active vehicle if vehicleId not provided
 * @connectorReservation Decrements available ports atomically to prevent overbooking
 */
const startCharging = async (
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

  const { stationId, connectorType, vehicleId, notifyAtPercent } = req.body;
  const sessionUserId = req.user?.id;

  // Optional "notify me at this battery %" threshold. Normalized to an integer in
  // [1, 99], or null when absent/invalid (notifications are opt-in).
  const parsedNotifyAtPercent =
    notifyAtPercent === undefined ||
    notifyAtPercent === null ||
    notifyAtPercent === ""
      ? null
      : (() => {
          const n = Math.round(Number(notifyAtPercent));
          return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
        })();

  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  try {
    const activeChargingTicket = await ChargingTicket.findOne({
      user: sessionUserId,
      chargingStatus: "IN_PROGRESS",
      station: { $ne: stationId },
    }).select({ _id: 1 });

    if (activeChargingTicket) {
      return next(
        new HttpError(
          "You already have a charging session in progress at another station.",
          409
        )
      );
    }
  } catch (err) {
    return next(
      new HttpError("Starting charging failed, please try again.", 500)
    );
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
      new HttpError("Starting charging failed, please try again.", 500)
    );
  }

  if (!ticket) {
    return next(new HttpError("Active ticket not found.", 404));
  }

  const selectedConnectorType = resolveConnectorType(
    typeof connectorType === "string" ? connectorType : ticket.connectorType
  );

  if (!selectedConnectorType) {
    return next(
      new HttpError("Connector type is required to start charging.", 422)
    );
  }

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Starting charging failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  if (
    !station.connectors.some((connector: { type: string }) => {
      return connector.type === selectedConnectorType;
    })
  ) {
    return next(
      new HttpError(
        "Requested connector type is not available at this station.",
        422
      )
    );
  }

  const resolvedChargingSpeed = resolveChargingSpeed(ticket.chargingSpeed);
  if (
    !isChargingSpeedSupported(
      station,
      resolvedChargingSpeed,
      selectedConnectorType
    )
  ) {
    return next(
      new HttpError(
        "Requested charging speed is not supported for the selected connector.",
        422
      )
    );
  }

  if (ticket.chargingSpeed !== resolvedChargingSpeed) {
    ticket.chargingSpeed = resolvedChargingSpeed;
  }

  let selectedVehicleId: string | null = null;
  let selectedVehicleBatteryPercent: number | null = null;
  let selectedVehicleBatteryCapacity: number | null = null;
  if (typeof vehicleId === "string") {
    let vehicle;
    try {
      vehicle = await Vehicle.findOne({
        _id: vehicleId,
        owner: sessionUserId,
      });
    } catch (err) {
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }

    if (!vehicle) {
      return next(new HttpError("Vehicle not found.", 404));
    }

    selectedVehicleId = vehicle._id.toString();
    selectedVehicleBatteryPercent =
      typeof vehicle.batteryPercent === "number"
        ? vehicle.batteryPercent
        : null;
    selectedVehicleBatteryCapacity =
      typeof vehicle.batteryCapacity === "number" &&
      Number.isFinite(vehicle.batteryCapacity)
        ? vehicle.batteryCapacity
        : null;
    ticket.vehicle = vehicle._id;
  } else if (ticket.vehicle) {
    selectedVehicleId =
      ticket.vehicle?.toString?.() ?? ticket.vehicle?.id ?? ticket.vehicle;
  } else {
    let activeVehicle = null;
    try {
      activeVehicle = await Vehicle.findOne({
        owner: sessionUserId,
        active: true,
      }).sort({ _id: -1 });
    } catch (err) {
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }

    if (activeVehicle) {
      selectedVehicleId = activeVehicle._id.toString();
      selectedVehicleBatteryPercent =
        typeof activeVehicle.batteryPercent === "number"
          ? activeVehicle.batteryPercent
          : null;
      selectedVehicleBatteryCapacity =
        typeof activeVehicle.batteryCapacity === "number" &&
        Number.isFinite(activeVehicle.batteryCapacity)
          ? activeVehicle.batteryCapacity
          : null;
      ticket.vehicle = activeVehicle._id;
    }
  }

  if (!selectedVehicleId) {
    return next(new HttpError("Vehicle is required to start charging.", 422));
  }

  if (selectedVehicleBatteryPercent === null) {
    try {
      const vehicle = await Vehicle.findOne(
        { _id: selectedVehicleId, owner: sessionUserId },
        { batteryPercent: 1, batteryCapacity: 1 }
      ).lean();

      if (!vehicle) {
        return next(new HttpError("Vehicle not found.", 404));
      }

      selectedVehicleBatteryPercent =
        typeof vehicle.batteryPercent === "number"
          ? vehicle.batteryPercent
          : null;
      selectedVehicleBatteryCapacity =
        typeof vehicle.batteryCapacity === "number" &&
        Number.isFinite(vehicle.batteryCapacity)
          ? vehicle.batteryCapacity
          : null;
    } catch (err) {
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }
  }

  let targetBatteryPercent: number | null = null;
  if (
    typeof selectedVehicleBatteryPercent === "number" &&
    Number.isFinite(selectedVehicleBatteryPercent) &&
    typeof ticket.ticketKwh === "number" &&
    Number.isFinite(ticket.ticketKwh) &&
    ticket.ticketKwh > 0 &&
    typeof selectedVehicleBatteryCapacity === "number" &&
    Number.isFinite(selectedVehicleBatteryCapacity) &&
    selectedVehicleBatteryCapacity > 0
  ) {
    const percentFromKwh =
      (ticket.ticketKwh / selectedVehicleBatteryCapacity) * 100;
    targetBatteryPercent = Math.min(
      100,
      Math.max(0, selectedVehicleBatteryPercent + percentFromKwh)
    );
  }

  const chargingDurationMs = calculateChargingDurationMs(
    selectedVehicleBatteryPercent,
    ticket.chargingSpeed,
    targetBatteryPercent
  );

  // Atomically claim the port reservation so two concurrent start requests can't
  // each reserve a port for the same ticket: only the request that flips
  // portReserved false->true goes on to reserve a physical port.
  let reservedConnector = false;
  const reservationClaim = await ChargingTicket.findOneAndUpdate(
    { _id: ticket.id, portReserved: { $ne: true } },
    { $set: { portReserved: true } }
  );

  if (reservationClaim) {
    try {
      const reserveResult = await adjustStationConnectorAvailability(
        stationId,
        selectedConnectorType,
        -1
      );

      if (!reserveResult.ok) {
        // Release the claim so the ticket isn't left "reserved" with no port.
        await ChargingTicket.updateOne(
          { _id: ticket.id },
          { $set: { portReserved: false } }
        ).catch(() => undefined);
        return next(
          new HttpError(
            "No available ports for the selected connector type.",
            409
          )
        );
      }
      reservedConnector = true;
    } catch (err) {
      await ChargingTicket.updateOne(
        { _id: ticket.id },
        { $set: { portReserved: false } }
      ).catch(() => undefined);
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }
  }

  ticket.portReserved = true;
  ticket.chargingStatus = "IN_PROGRESS";
  ticket.startedAt = ticket.startedAt ?? new Date();
  ticket.completedAt = undefined;
  ticket.progressPercent = 0;
  ticket.connectorType = selectedConnectorType;
  ticket.chargingDurationMs = chargingDurationMs;
  if (
    typeof selectedVehicleBatteryPercent === "number" &&
    Number.isFinite(selectedVehicleBatteryPercent)
  ) {
    ticket.startingBatteryPercent = selectedVehicleBatteryPercent;
  }
  if (typeof targetBatteryPercent === "number") {
    ticket.set("targetBatteryPercent", targetBatteryPercent);
  }
  // Cap the notify-at threshold to the battery % this session can actually reach
  // (its target). A threshold above the reachable target could never fire as a
  // distinct event; capping makes the alert deliverable (at/just before completion).
  let notifyThreshold = parsedNotifyAtPercent;
  if (
    notifyThreshold != null &&
    typeof targetBatteryPercent === "number" &&
    Number.isFinite(targetBatteryPercent)
  ) {
    const reachableTarget = Math.round(targetBatteryPercent);
    if (notifyThreshold > reachableTarget) {
      notifyThreshold = reachableTarget >= 1 ? reachableTarget : null;
    }
  }
  // Set the notify-at threshold and (re)arm the one-shot guard for this session so
  // a restart can notify again.
  ticket.set("notifyAtPercent", notifyThreshold);
  ticket.set("notifyAtReachedAt", null);

  try {
    await ticket.save();
  } catch (err) {
    if (reservedConnector) {
      try {
        await adjustStationConnectorAvailability(
          stationId,
          selectedConnectorType,
          1
        );
      } catch (rollbackErr) {
        // Ignore rollback failures; the connector count will be reconciled later.
      }
      await ChargingTicket.updateOne(
        { _id: ticket.id },
        { $set: { portReserved: false } }
      ).catch(() => undefined);
    }
    return next(
      new HttpError("Starting charging failed, please try again.", 500)
    );
  }

  try {
    await setVehicleChargingStatus(selectedVehicleId, "CHARGING");
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
      type: "started",
      ticket: ticketPayload,
    }
  );

  // Clear any existing timer first so a restart (e.g. with a changed notify-at
  // threshold) rebuilds the snapshot the timer reads from, instead of keeping a
  // stale one — ensureChargingProgressTimer no-ops when a timer already exists.
  clearChargingProgressTimer(ticket.id);
  ensureChargingProgressTimer(ticket);

  res.status(200).json({
    message: "Charging started successfully!",
    ticket: ticketPayload,
  });
};

export { startCharging };
