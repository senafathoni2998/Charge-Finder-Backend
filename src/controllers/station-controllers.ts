import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../models/http-error";
import Station from "../models/station";
import User from "../models/user";
import ChargingTicket from "../models/charging-ticket";
import Vehicle from "../models/vehicle";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../realtime/charging-progress";
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
} from "../services/charging-ticket-service";

const addStation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const {
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos = [],
    pricing,
    amenities = [],
    notes,
  } = req.body;

  let newStation = new Station({
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos,
    pricing,
    amenities,
    notes,
  });

  try {
    await newStation.save();
  } catch (err) {
    return next(new HttpError("Creating station failed, please try again.", 500));
  }

  res.status(201).json({
    message: "New station added successfully!",
    station: newStation.toObject({ getters: true }),
  });
};

const updateStation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const {
    stationId,
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos,
    pricing,
    amenities,
    notes,
  } = req.body;

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  if (typeof name === "string") {
    station.name = name;
  }

  if (lat !== undefined) {
    station.lat = lat;
  }

  if (lng !== undefined) {
    station.lng = lng;
  }

  if (typeof address === "string") {
    station.address = address;
  }

  if (Array.isArray(connectors)) {
    station.set("connectors", connectors);
  }

  if (status === "AVAILABLE" || status === "BUSY" || status === "OFFLINE") {
    station.status = status;
  }

  if (typeof lastUpdatedISO === "string") {
    station.lastUpdatedISO = lastUpdatedISO;
  }

  if (Array.isArray(photos)) {
    station.set("photos", photos);
  }

  if (pricing !== undefined) {
    station.pricing = pricing;
  }

  if (Array.isArray(amenities)) {
    station.amenities = amenities;
  }

  if (typeof notes === "string") {
    station.notes = notes;
  }

  try {
    await station.save();
  } catch (err) {
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  res.status(200).json({
    message: "Station updated successfully!",
    station: station.toObject({ getters: true }),
  });
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

  const { stationId, connectorType, vehicleId } = req.body;
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

  res.status(201).json({
    message: "Charging ticket requested successfully!",
    ticket: newTicket.toObject({ getters: true }),
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
    const chargingDurationMs =
      await resolveChargingDurationMsForTicket(activeTicket);
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

  const resolveConnectorType = (value: unknown) => {
    if (value === "CCS2" || value === "Type2" || value === "CHAdeMO") {
      return value;
    }
    return null;
  };

  const selectedConnectorType = resolveConnectorType(
    typeof connectorType === "string" ? connectorType : ticket.connectorType
  );

  if (!selectedConnectorType) {
    return next(
      new HttpError("Connector type is required to start charging.", 422)
    );
  }

  let selectedVehicleId: string | null = null;
  let selectedVehicleBatteryPercent: number | null = null;
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
      typeof vehicle.batteryPercent === "number" ? vehicle.batteryPercent : null;
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
      ticket.vehicle = activeVehicle._id;
    }
  }

  if (!selectedVehicleId) {
    return next(
      new HttpError("Vehicle is required to start charging.", 422)
    );
  }

  if (selectedVehicleBatteryPercent === null) {
    try {
      const vehicle = await Vehicle.findOne(
        { _id: selectedVehicleId, owner: sessionUserId },
        { batteryPercent: 1 }
      ).lean();

      if (!vehicle) {
        return next(new HttpError("Vehicle not found.", 404));
      }

      selectedVehicleBatteryPercent =
        typeof vehicle.batteryPercent === "number"
          ? vehicle.batteryPercent
          : null;
    } catch (err) {
      return next(
        new HttpError("Starting charging failed, please try again.", 500)
      );
    }
  }

  const chargingDurationMs = calculateChargingDurationMs(
    selectedVehicleBatteryPercent
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

  broadcastChargingProgress(buildChargingProgressKey(sessionUserId, stationId), {
    type: "started",
    ticket: ticketPayload,
  });

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
        new HttpError(
          "Completing charging failed, please try again.",
          500
        )
      );
    }
    if (ticketVehicleId && typeof completedBatteryPercentage === "number") {
      void updateVehicleBatteryPercentage(
        ticketVehicleId,
        completedBatteryPercentage
      ).catch(() => {});
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

  broadcastChargingProgress(buildChargingProgressKey(sessionUserId, stationId), {
    type: "progress",
    ticket: ticketPayload,
  });

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

  broadcastChargingProgress(buildChargingProgressKey(sessionUserId, stationId), {
    type: "cancelled",
    ticket: null,
    cancelledTicket,
  });

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

  broadcastChargingProgress(buildChargingProgressKey(sessionUserId, stationId), {
    type: "completed",
    ticket: null,
    completedTicket: ticketSnapshot,
  });

  res.status(200).json({
    message: "Charging completed and ticket cleared successfully!",
    completedTicket: ticketSnapshot,
  });
};

const deleteStation = async (
  req: Request,
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

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Deleting station failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  try {
    await station.deleteOne();
  } catch (err) {
    return next(
      new HttpError("Deleting station failed, please try again.", 500)
    );
  }

  res.status(200).json({ message: "Station deleted successfully!" });
};

const getStations = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const sessionUserId = req.user?.id ?? req.session?.user?.id;

  let stations;
  try {
    stations = await Station.find();
  } catch (err) {
    return next(
      new HttpError("Fetching stations failed, please try again later.", 500)
    );
  }

  if (!stations || stations.length === 0) {
    return next(new HttpError("Could not find stations.", 404));
  }

  const chargingStationIds = new Set<string>();

  if (sessionUserId) {
    try {
      const chargingTickets = await ChargingTicket.find(
        {
          user: sessionUserId,
          status: { $in: ["REQUESTED", "PAID"] },
          chargingStatus: "IN_PROGRESS",
        },
        { station: 1 }
      ).lean();

      for (const ticket of chargingTickets) {
        const stationId =
          ticket.station?.toString?.() ?? ticket.station?.id ?? ticket.station;
        if (stationId) {
          chargingStationIds.add(stationId.toString());
        }
      }
    } catch (err) {
      return next(
        new HttpError(
          "Fetching charging status failed, please try again later.",
          500
        )
      );
    }
  }

  const resolveStationId = (snapshot: Record<string, unknown>) => {
    const stationId = snapshot.id;
    if (typeof stationId === "string") {
      return stationId;
    }

    const rawId = snapshot._id;
    if (typeof rawId === "string") {
      return rawId;
    }

    if (rawId && typeof (rawId as { toString?: () => string }).toString === "function") {
      return (rawId as { toString: () => string }).toString();
    }

    return null;
  };

  const stationsPayload = stations.map((station) => {
    const stationSnapshot = station.toObject({ getters: true }) as Record<
      string,
      unknown
    >;
    const stationId = resolveStationId(stationSnapshot);

    return {
      ...stationSnapshot,
      isChargingHere: stationId ? chargingStationIds.has(stationId) : false,
    };
  });

  res.json({
    stations: stationsPayload,
  });
};

const getStationById = async (
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
  const sessionUserId = req.user?.id ?? req.session?.user?.id;

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Fetching station failed, please try again later.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  let isChargingHere = false;
  if (sessionUserId) {
    try {
      const chargingTicket = await ChargingTicket.findOne(
        {
          user: sessionUserId,
          station: stationId,
          status: { $in: ["REQUESTED", "PAID"] },
          chargingStatus: "IN_PROGRESS",
        },
        { _id: 1 }
      ).lean();

      isChargingHere = Boolean(chargingTicket);
    } catch (err) {
      return next(
        new HttpError(
          "Fetching charging status failed, please try again later.",
          500
        )
      );
    }
  }

  res.status(200).json({
    station: {
      ...station.toObject({ getters: true }),
      isChargingHere,
    },
  });
};

export {
  addStation,
  updateStation,
  requestChargingTicket,
  getActiveTicketForStation,
  startCharging,
  updateChargingProgress,
  completeCharging,
  cancelCharging,
  deleteStation,
  getStations,
  getStationById,
};
