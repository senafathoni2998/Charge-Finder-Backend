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
  updateVehicleBatteryPercentage,
} from "../../services/charging-ticket-service";
import { recordChargingHistory } from "../../services/charging-history-service";
import {
  isChargingSpeedSupported,
  resolveChargingSpeed,
} from "./station-charging-helpers";

const resolveConnectorType = (value: unknown) => {
  if (value === "CCS2" || value === "Type2" || value === "CHAdeMO") {
    return value;
  }

  return null;
};

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

  try {
    const sess = await mongoose.startSession();
    sess.startTransaction();
    await newTicket.save({ session: sess });
    user.tickets.push(newTicket._id);
    await user.save({ session: sess });
    await sess.commitTransaction();
  } catch (err) {
    return next(
      new HttpError("Requesting ticket failed, please try again.", 500)
    );
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
      const ticketVehicleId =
        activeTicket.vehicle?.toString?.() ??
        activeTicket.vehicle?.id ??
        activeTicket.vehicle;
      const completedBatteryPercentage = (
        completedTicket as { batteryPercentage?: number }
      ).batteryPercentage;

      try {
        await finalizeChargingTicket(activeTicket.id, sessionUserId);
        clearChargingProgressTimer(activeTicket.id);
        if (
          ticketVehicleId &&
          typeof completedBatteryPercentage === "number"
        ) {
          void updateVehicleBatteryPercentage(
            ticketVehicleId,
            completedBatteryPercentage
          ).catch(() => {});
        }
        try {
          await recordChargingHistory({
            userId: sessionUserId,
            ticketSnapshot: completedTicket,
            outcome: "COMPLETED",
            endedAt: completedAt,
          });
        } catch (err) {
          // Best-effort: history should not block completion.
        }
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

  const shouldReserveConnector =
    ticket.chargingStatus !== "IN_PROGRESS" || !ticket.startedAt;

  let reservedConnector = false;
  if (shouldReserveConnector) {
    try {
      const reserveResult = await adjustStationConnectorAvailability(
        stationId,
        selectedConnectorType,
        -1
      );

      if (!reserveResult.ok) {
        return next(
          new HttpError(
            "No available ports for the selected connector type.",
            409
          )
        );
      }
      reservedConnector = true;
    } catch (err) {
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }
  }

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
    const ticketVehicleId =
      ticket.vehicle?.toString?.() ?? ticket.vehicle?.id ?? ticket.vehicle;
    const completedBatteryPercentage = (
      completedTicket as { batteryPercentage?: number }
    ).batteryPercentage;

    try {
      await finalizeChargingTicket(ticket.id, sessionUserId);
      clearChargingProgressTimer(ticket.id);
    } catch (err) {
      return next(
        new HttpError("Completing charging failed, please try again.", 500)
      );
    }
    if (ticketVehicleId && typeof completedBatteryPercentage === "number") {
      void updateVehicleBatteryPercentage(
        ticketVehicleId,
        completedBatteryPercentage
      ).catch(() => {});
    }
    try {
      await recordChargingHistory({
        userId: sessionUserId,
        ticketSnapshot: completedTicket,
        outcome: "COMPLETED",
        endedAt: completedAt,
      });
    } catch (err) {
      // Best-effort: history should not block completion.
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
  const ticketVehicleId =
    ticket.vehicle?.toString?.() ?? ticket.vehicle?.id ?? ticket.vehicle;
  const cancelledBatteryPercentage = (
    cancelledTicket as { batteryPercentage?: number }
  ).batteryPercentage;

  try {
    await finalizeChargingTicket(ticket.id, sessionUserId);
    clearChargingProgressTimer(ticket.id);
  } catch (err) {
    return next(
      new HttpError("Cancelling charging failed, please try again.", 500)
    );
  }
  if (ticketVehicleId && typeof cancelledBatteryPercentage === "number") {
    void updateVehicleBatteryPercentage(
      ticketVehicleId,
      cancelledBatteryPercentage
    ).catch(() => {});
  }
  try {
    await recordChargingHistory({
      userId: sessionUserId,
      ticketSnapshot: cancelledTicket,
      outcome: "CANCELLED",
      endedAt: cancelledAt,
    });
  } catch (err) {
    // Best-effort: history should not block cancellation.
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
  const ticketVehicleId =
    ticket.vehicle?.toString?.() ?? ticket.vehicle?.id ?? ticket.vehicle;
  const completedBatteryPercentage = (
    ticketSnapshot as { batteryPercentage?: number }
  ).batteryPercentage;

  try {
    await finalizeChargingTicket(ticket.id, sessionUserId);
    clearChargingProgressTimer(ticket.id);
  } catch (err) {
    return next(
      new HttpError("Completing charging failed, please try again.", 500)
    );
  }
  if (ticketVehicleId && typeof completedBatteryPercentage === "number") {
    void updateVehicleBatteryPercentage(
      ticketVehicleId,
      completedBatteryPercentage
    ).catch(() => {});
  }
  try {
    await recordChargingHistory({
      userId: sessionUserId,
      ticketSnapshot: ticketSnapshot,
      outcome: "COMPLETED",
      endedAt: completedAt,
    });
  } catch (err) {
    // Best-effort: history should not block completion.
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
