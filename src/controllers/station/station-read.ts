import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../models/http-error";
import Station from "../../models/station";
import ChargingTicket from "../../models/charging-ticket";

/**
 * Normalizes query parameter values (handles arrays)
 * @param value Query parameter value that might be an array or single value
 * @returns First element if array, otherwise the value itself
 */
const normalizeQueryValue = (value: unknown) => {
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Parses query parameter to number
 * @param value Query parameter value to parse
 * @returns Parsed number if valid, null otherwise
 */
const parseQueryNumber = (value: unknown) => {
  const normalized = normalizeQueryValue(value);
  if (typeof normalized !== "string" && typeof normalized !== "number") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Extracts station ID from various formats
 * @param snapshot Station object snapshot
 * @returns Station ID as string or null if not found
 */
const resolveStationId = (snapshot: Record<string, unknown>) => {
  const stationId = snapshot.id;
  if (typeof stationId === "string") {
    return stationId;
  }

  const rawId = snapshot._id;
  if (typeof rawId === "string") {
    return rawId;
  }

  if (
    rawId &&
    typeof (rawId as { toString?: () => string }).toString === "function"
  ) {
    return (rawId as { toString: () => string }).toString();
  }

  return null;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

/**
 * Calculates distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in kilometers, rounded to 2 decimal places
 */
const calculateDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 100) / 100;
};

type StationPayload = Record<string, unknown> & {
  distanceKm?: number;
  isChargingHere: boolean;
};

/**
 * Retrieves list of charging stations with optional location filtering
 * 
 * @purpose Public endpoint to discover available charging stations
 * @authentication Optional - if authenticated, includes isChargingHere flag for active sessions
 * @locationFiltering Supports filtering by distance from user location
 * @query lat, lng (optional) - User coordinates for distance calculation
 * @query radiusKm (optional) - Maximum distance from user location
 * @query limit (optional) - Maximum number of stations to return
 * @returns JSON response with array of stations, sorted by distance if location provided
 * @note Calculates distance using Haversine formula for accurate results
 */
const getStations = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const sessionUserId = req.user?.id ?? req.session?.user?.id;

  const userLat = parseQueryNumber(req.query.lat);
  const userLng = parseQueryNumber(req.query.lng);
  const radiusKm = parseQueryNumber(req.query.radiusKm);
  const limit = parseQueryNumber(req.query.limit);

  if (
    (userLat !== null && userLng === null) ||
    (userLng !== null && userLat === null)
  ) {
    return next(
      new HttpError("Both lat and lng query params are required.", 422)
    );
  }

  const hasLocation = userLat !== null && userLng !== null;
  if (hasLocation) {
    if (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
      return next(new HttpError("Invalid location coordinates.", 422));
    }
  }

  if (radiusKm !== null && radiusKm < 0) {
    return next(new HttpError("Invalid radiusKm value.", 422));
  }

  if (limit !== null && limit <= 0) {
    return next(new HttpError("Invalid limit value.", 422));
  }

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

  // If user is logged in, check which stations they're currently charging at
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
          ticket.station?.toString?.() ??
          ticket.station?.id ??
          ticket.station;
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

  let stationsPayload: StationPayload[] = stations.map((station) => {
    const stationSnapshot = station.toObject({ getters: true }) as Record<
      string,
      unknown
    >;
    const stationId = resolveStationId(stationSnapshot);
    const stationLat =
      typeof stationSnapshot.lat === "number" ? stationSnapshot.lat : null;
    const stationLng =
      typeof stationSnapshot.lng === "number" ? stationSnapshot.lng : null;
    const distanceKm =
      hasLocation && stationLat !== null && stationLng !== null
        ? calculateDistanceKm(
            userLat as number,
            userLng as number,
            stationLat,
            stationLng
          )
        : undefined;

    return {
      ...stationSnapshot,
      isChargingHere: stationId ? chargingStationIds.has(stationId) : false,
      ...(hasLocation && distanceKm !== undefined ? { distanceKm } : {}),
    };
  });

  // Apply location-based filtering and sorting if coordinates provided
  if (hasLocation) {
    stationsPayload = stationsPayload.filter(
      (station) => typeof station.distanceKm === "number"
    );

    if (radiusKm !== null) {
      stationsPayload = stationsPayload.filter(
        (station) => (station.distanceKm ?? 0) <= radiusKm
      );
    }

    stationsPayload.sort(
      (a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)
    );

    if (limit !== null) {
      stationsPayload = stationsPayload.slice(0, Math.floor(limit));
    }
  }

  res.json({
    stations: stationsPayload,
  });
};

/**
 * Retrieves detailed information about a specific station
 * 
 * @purpose Endpoint to fetch details of a single charging station by ID
 * @authentication Optional - if authenticated, includes isChargingHere flag
 * @validates Checks if station ID is a valid MongoDB ObjectId
 * @params stationId - Station ID from URL params
 * @returns JSON response with station details and charging status
 */
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

  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

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

  // Check if user is currently charging at this station
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

export { getStations, getStationById };
