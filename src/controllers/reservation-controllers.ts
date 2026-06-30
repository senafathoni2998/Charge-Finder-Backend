import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../models/http-error";
import Station from "../models/station";
import Vehicle from "../models/vehicle";
import Reservation from "../models/reservation";
import type { ConnectorType } from "../models/station";
import {
  validateReservationWindow,
  getConnectorPorts,
  countOverlappingReservations,
  userHasOverlappingReservation,
  buildReservationPayload,
} from "../services/reservation-service";

type SessionReq = Request & {
  user?: { id: string; role?: "admin" | "user" };
};

const resolveSessionUser = (req: SessionReq) => {
  const user = req.user ?? req.session?.user;
  return {
    id: user?.id,
    isAdmin: user?.role === "admin",
  };
};

const normalizeQueryValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

const toDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value as string);
};

const isConnectorType = (value: unknown): value is ConnectorType =>
  value === "CCS2" || value === "Type2" || value === "CHAdeMO";

/**
 * Creates a reservation holding one connector-type port at a station for a window.
 *
 * @authentication Required.
 * @eligibility Window must satisfy the booking rules; the user may not already hold an
 *   overlapping reservation; and the connector type must have a free port for the
 *   window (capacity = connector.ports).
 * @body stationId, connectorType, startTime, endTime, vehicleId?, notes?
 */
const createReservation = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { id: userId } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { stationId, connectorType, startTime, endTime, vehicleId, notes } =
    req.body;

  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }
  if (!isConnectorType(connectorType)) {
    return next(new HttpError("Invalid connector type.", 422));
  }
  if (vehicleId !== undefined && !mongoose.Types.ObjectId.isValid(vehicleId)) {
    return next(new HttpError("Invalid vehicle id.", 422));
  }

  const start = toDate(startTime);
  const end = toDate(endTime);
  const windowError = validateReservationWindow(start, end, new Date());
  if (windowError) {
    return next(new HttpError(windowError, 422));
  }

  try {
    const station = await Station.findById(stationId).lean();
    if (!station) {
      return next(new HttpError("Station not found.", 404));
    }

    const ports = getConnectorPorts(station, connectorType);
    if (ports === null) {
      return next(
        new HttpError(
          `This station has no ${connectorType} connector.`,
          422
        )
      );
    }
    if (ports <= 0) {
      return next(
        new HttpError(
          `No ${connectorType} ports exist at this station.`,
          409
        )
      );
    }

    // If a vehicle is supplied it must belong to the caller.
    if (vehicleId !== undefined) {
      const vehicle = await Vehicle.findById(vehicleId).lean();
      if (!vehicle) {
        return next(new HttpError("Vehicle not found.", 404));
      }
      if (String((vehicle as { owner?: unknown }).owner) !== String(userId)) {
        return next(new HttpError("You do not own this vehicle.", 403));
      }
    }

    if (await userHasOverlappingReservation(userId, start, end)) {
      return next(
        new HttpError(
          "You already have a reservation during this time window.",
          409
        )
      );
    }

    const reserved = await countOverlappingReservations(
      stationId,
      connectorType,
      start,
      end
    );
    if (reserved >= ports) {
      return next(
        new HttpError(
          `No ${connectorType} ports are available for the selected time.`,
          409
        )
      );
    }

    const reservation = new Reservation({
      user: userId,
      station: stationId,
      connectorType,
      startTime: start,
      endTime: end,
      ...(vehicleId !== undefined ? { vehicle: vehicleId } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
    });
    await reservation.save();
    await reservation.populate([
      { path: "station", select: "name address" },
      { path: "vehicle", select: "name" },
    ]);

    res.status(201).json({
      message: "Reservation confirmed.",
      reservation: buildReservationPayload(
        reservation.toObject({ getters: true }) as Record<string, unknown>
      ),
    });
  } catch (err) {
    return next(
      new HttpError("Creating reservation failed, please try again.", 500)
    );
  }
};

/**
 * Lists the authenticated user's reservations, soonest-starting first.
 *
 * @authentication Required.
 * @query status (ACTIVE|CANCELLED), upcoming (true → only not-yet-elapsed ACTIVE)
 */
const getMyReservations = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const { id: userId } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const statusFilter = normalizeQueryValue(req.query.status);
  const upcoming = normalizeQueryValue(req.query.upcoming) === "true";

  const filter: Record<string, unknown> = { user: userId };
  if (statusFilter === "ACTIVE" || statusFilter === "CANCELLED") {
    filter.status = statusFilter;
  }
  if (upcoming) {
    filter.status = "ACTIVE";
    filter.endTime = { $gte: new Date() };
  }

  let reservations;
  try {
    reservations = await Reservation.find(filter)
      .sort({ startTime: -1 })
      .populate("station", "name address")
      .populate("vehicle", "name")
      .lean();
  } catch (err) {
    return next(
      new HttpError("Fetching reservations failed, please try again later.", 500)
    );
  }

  const now = new Date();
  res.status(200).json({
    reservations: reservations.map((r) =>
      buildReservationPayload(r as Record<string, unknown>, now)
    ),
  });
};

/**
 * Returns a single reservation. Owners and admins only.
 *
 * @authentication Required.
 */
const getReservationById = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { id: userId, isAdmin } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { reservationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(reservationId)) {
    return next(new HttpError("Invalid reservation id.", 422));
  }

  let reservation;
  try {
    reservation = await Reservation.findById(reservationId)
      .populate("station", "name address")
      .populate("vehicle", "name")
      .lean();
  } catch (err) {
    return next(
      new HttpError("Fetching reservation failed, please try again later.", 500)
    );
  }

  if (!reservation) {
    return next(new HttpError("Reservation not found.", 404));
  }

  if (!isAdmin && String((reservation as { user?: unknown }).user) !== String(userId)) {
    return next(new HttpError("Forbidden.", 403));
  }

  res.status(200).json({
    reservation: buildReservationPayload(reservation as Record<string, unknown>),
  });
};

/**
 * Cancels a reservation (sets status CANCELLED, freeing its slot). Owners and admins
 * only; cancelling an already-cancelled reservation is idempotent.
 *
 * @authentication Required.
 */
const cancelReservation = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { id: userId, isAdmin } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { reservationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(reservationId)) {
    return next(new HttpError("Invalid reservation id.", 422));
  }

  let reservation;
  try {
    reservation = await Reservation.findById(reservationId);
  } catch (err) {
    return next(
      new HttpError("Cancelling reservation failed, please try again.", 500)
    );
  }

  if (!reservation) {
    return next(new HttpError("Reservation not found.", 404));
  }

  if (!isAdmin && String(reservation.get("user")) !== String(userId)) {
    return next(new HttpError("Forbidden.", 403));
  }

  if (reservation.get("status") === "ACTIVE") {
    reservation.set("status", "CANCELLED");
    try {
      await reservation.save();
    } catch (err) {
      return next(
        new HttpError("Cancelling reservation failed, please try again.", 500)
      );
    }
  }

  res.status(200).json({
    message: "Reservation cancelled.",
    reservation: buildReservationPayload(
      reservation.toObject({ getters: true }) as Record<string, unknown>
    ),
  });
};

/**
 * Reports remaining capacity for a station+connector over a window.
 *
 * @authentication Required.
 * @query stationId, connectorType, startTime, endTime
 */
const getAvailability = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const stationId = normalizeQueryValue(req.query.stationId);
  const connectorType = normalizeQueryValue(req.query.connectorType);

  if (typeof stationId !== "string" || !mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }
  if (!isConnectorType(connectorType)) {
    return next(new HttpError("Invalid connector type.", 422));
  }

  const start = toDate(normalizeQueryValue(req.query.startTime));
  const end = toDate(normalizeQueryValue(req.query.endTime));
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() <= start.getTime()
  ) {
    return next(new HttpError("Invalid time window.", 422));
  }

  try {
    const station = await Station.findById(stationId).lean();
    if (!station) {
      return next(new HttpError("Station not found.", 404));
    }

    const ports = getConnectorPorts(station, connectorType);
    if (ports === null) {
      return next(
        new HttpError(`This station has no ${connectorType} connector.`, 422)
      );
    }

    const reserved = await countOverlappingReservations(
      stationId,
      connectorType,
      start,
      end
    );

    res.status(200).json({
      stationId,
      connectorType,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      ports,
      reserved,
      available: Math.max(0, ports - reserved),
    });
  } catch (err) {
    return next(
      new HttpError("Checking availability failed, please try again later.", 500)
    );
  }
};

/**
 * Admin moderation: lists all reservations for a station (newest-starting first).
 *
 * @authentication Admin (enforced by adminMiddleware on the route).
 * @query upcoming (true → only not-yet-elapsed ACTIVE), status (ACTIVE|CANCELLED)
 */
const getStationReservations = async (
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

  const { stationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  const statusFilter = normalizeQueryValue(req.query.status);
  const upcoming = normalizeQueryValue(req.query.upcoming) === "true";

  const filter: Record<string, unknown> = { station: stationId };
  if (statusFilter === "ACTIVE" || statusFilter === "CANCELLED") {
    filter.status = statusFilter;
  }
  if (upcoming) {
    filter.status = "ACTIVE";
    filter.endTime = { $gte: new Date() };
  }

  let reservations;
  try {
    reservations = await Reservation.find(filter)
      .sort({ startTime: -1 })
      .populate("user", "name")
      .populate("vehicle", "name")
      .lean();
  } catch (err) {
    return next(
      new HttpError("Fetching reservations failed, please try again later.", 500)
    );
  }

  const now = new Date();
  res.status(200).json({
    reservations: reservations.map((r) => {
      const payload = buildReservationPayload(r as Record<string, unknown>, now);
      // Admins also see who holds each slot.
      const rawUser = (r as { user?: unknown }).user;
      payload.user =
        rawUser && typeof rawUser === "object" && !(rawUser instanceof mongoose.Types.ObjectId)
          ? {
              id: String((rawUser as { _id?: unknown })._id ?? ""),
              name: (rawUser as { name?: unknown }).name ?? null,
            }
          : { id: String(rawUser ?? ""), name: null };
      return payload;
    }),
  });
};

export {
  createReservation,
  getMyReservations,
  getReservationById,
  cancelReservation,
  getAvailability,
  getStationReservations,
};
