import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../models/http-error";
import Station from "../../models/station";
import User from "../../models/user";
import ChargingTicket from "../../models/charging-ticket";
import Vehicle from "../../models/vehicle";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../../realtime/charging-progress";
import {
  adjustStationConnectorAvailability,
  appendChargingBatteryPercentage,
  buildChargingTicketPayload,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  setVehicleChargingStatus,
  setActiveVehicleChargingStatus,
  finalizeChargingTicket,
  resolveChargingDurationMsForTicket,
} from "../../services/charging-ticket-service";
import {
  isChargingSpeedSupported,
  resolveChargingSpeed,
} from "./station-charging-helpers";

/**
 * Validates and returns connector type from input
 * @param value Raw connector type value  
 * @returns Valid connector type or null
 */
const resolveConnectorType = (value: unknown) => {
  if (value === "CCS2" || value === "Type2" || value === "CHAdeMO") {
    return value;
  }

  return null;
};

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

  const { stationId, connectorType, vehicleId } = req.body;
  const sessionUserId = req.user?.id;

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

  ensureChargingProgressTimer(ticket);

  res.status(200).json({
    message: "Charging started successfully!",
    ticket: ticketPayload,
  });
};

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

export {
  requestChargingTicket,
  getActiveTicketForStation,
  startCharging,
  updateChargingProgress,
  completeCharging,
  cancelCharging,
};
