import { Types } from "mongoose";

import Reservation from "../models/reservation";
import type { ConnectorType } from "../models/station";

// Booking-window bounds. Kept here (not env) since they're product rules, not infra.
export const RESERVATION_LIMITS = {
  MIN_DURATION_MS: 15 * 60 * 1000, // 15 minutes
  MAX_DURATION_MS: 4 * 60 * 60 * 1000, // 4 hours
  MAX_LEAD_MS: 7 * 24 * 60 * 60 * 1000, // 7 days ahead
  PAST_GRACE_MS: 60 * 1000, // allow a 1-min clock skew on "starts in the past"
};

// Two windows [s1,e1) and [s2,e2) overlap iff s1 < e2 AND s2 < e1.
const overlapWindow = (start: Date, end: Date) => ({
  startTime: { $lt: end },
  endTime: { $gt: start },
});

const resolveId = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof (value as { toString?: () => string }).toString === "function") {
    const stringified = (value as { toString: () => string }).toString();
    return stringified === "[object Object]" ? null : stringified;
  }
  return null;
};

// Shapes a possibly-populated ObjectId ref. A bare ObjectId is typeof "object", so
// exclude ObjectId/Buffer before treating the value as a populated document —
// otherwise reading `.id` would yield the raw 12-byte Buffer instead of the hex id.
const shapeRef = (
  value: unknown,
  pick: string[]
): Record<string, unknown> | string | null => {
  const isPopulated =
    !!value &&
    typeof value === "object" &&
    !(value instanceof Types.ObjectId) &&
    !Buffer.isBuffer(value);
  if (!isPopulated) {
    return resolveId(value);
  }
  const doc = value as Record<string, unknown>;
  const shaped: Record<string, unknown> = {
    id: resolveId(doc._id ?? doc.id),
  };
  for (const key of pick) {
    shaped[key] = doc[key] ?? null;
  }
  return shaped;
};

/**
 * Validates a requested reservation window against the product rules. Returns an error
 * message (for a 422) or null when the window is acceptable.
 */
export const validateReservationWindow = (
  start: Date,
  end: Date,
  now: Date
): string | null => {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Invalid reservation times.";
  }
  if (end.getTime() <= start.getTime()) {
    return "endTime must be after startTime.";
  }
  if (start.getTime() < now.getTime() - RESERVATION_LIMITS.PAST_GRACE_MS) {
    return "startTime cannot be in the past.";
  }
  if (start.getTime() > now.getTime() + RESERVATION_LIMITS.MAX_LEAD_MS) {
    return "Cannot reserve more than 7 days in advance.";
  }
  const durationMs = end.getTime() - start.getTime();
  if (durationMs < RESERVATION_LIMITS.MIN_DURATION_MS) {
    return "Reservation is too short (minimum 15 minutes).";
  }
  if (durationMs > RESERVATION_LIMITS.MAX_DURATION_MS) {
    return "Reservation is too long (maximum 4 hours).";
  }
  return null;
};

/**
 * Number of ports for a connector type on a station document, or null if the station
 * has no connector of that type.
 */
export const getConnectorPorts = (
  station: { connectors?: unknown } | null | undefined,
  connectorType: ConnectorType
): number | null => {
  const connectors = station?.connectors;
  if (!Array.isArray(connectors)) {
    return null;
  }
  const match = connectors.find(
    (c) => c && typeof c === "object" && (c as { type?: unknown }).type === connectorType
  );
  const ports = (match as { ports?: unknown } | undefined)?.ports;
  return typeof ports === "number" ? ports : null;
};

/**
 * Count of ACTIVE reservations for a station+connector whose window overlaps
 * [start, end). Optionally excludes one reservation id (used when re-checking on an
 * update). This is the capacity gate: a new booking is allowed only while this count
 * is below the connector's port count.
 */
export const countOverlappingReservations = async (
  stationId: string,
  connectorType: ConnectorType,
  start: Date,
  end: Date,
  excludeId?: string
): Promise<number> => {
  const filter: Record<string, unknown> = {
    station: stationId,
    connectorType,
    status: "ACTIVE",
    ...overlapWindow(start, end),
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return Reservation.countDocuments(filter);
};

/**
 * Whether the user already holds an ACTIVE reservation overlapping [start, end) (at any
 * station). Used to stop a user from double-booking themselves / hoarding slots.
 */
export const userHasOverlappingReservation = async (
  userId: string,
  start: Date,
  end: Date,
  excludeId?: string
): Promise<boolean> => {
  const filter: Record<string, unknown> = {
    user: userId,
    status: "ACTIVE",
    ...overlapWindow(start, end),
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const existing = await Reservation.exists(filter);
  return Boolean(existing);
};

/**
 * Shapes a (lean or hydrated) Reservation document into the API payload. `station` and
 * `vehicle` are exposed as ids, or as `{ id, ...picked }` when populated. `isPast` and
 * `effectiveStatus` are derived from the window so the client can render elapsed
 * reservations without a background sweeper.
 */
export const buildReservationPayload = (
  reservation: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> => {
  const endRaw = reservation.endTime;
  const end =
    endRaw instanceof Date
      ? endRaw
      : typeof endRaw === "string" || typeof endRaw === "number"
        ? new Date(endRaw)
        : null;
  const isPast = end ? end.getTime() < now.getTime() : false;
  const status =
    typeof reservation.status === "string" ? reservation.status : "ACTIVE";

  return {
    id: resolveId(reservation.id ?? reservation._id),
    station: shapeRef(reservation.station, ["name", "address"]),
    connectorType: reservation.connectorType ?? null,
    startTime: reservation.startTime ?? null,
    endTime: reservation.endTime ?? null,
    status,
    // ACTIVE but elapsed reads as EXPIRED to clients; the stored status stays ACTIVE.
    effectiveStatus: status === "ACTIVE" && isPast ? "EXPIRED" : status,
    isPast,
    vehicle: shapeRef(reservation.vehicle, ["name"]),
    notes: typeof reservation.notes === "string" ? reservation.notes : null,
    createdAt: reservation.createdAt ?? null,
    updatedAt: reservation.updatedAt ?? null,
  };
};
