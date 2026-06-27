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

type StationPayload = Record<string, unknown> & {
  distanceKm?: number;
  isChargingHere: boolean;
};

// Upper bounds on how many stations a single response may return.
const DEFAULT_NEARBY_LIMIT = 300;
const DEFAULT_LIST_LIMIT = 500;

// Shapes a station document from the $geoNear aggregation into the API payload:
// renames _id -> id, derives distanceKm from the geo distance, sets isChargingHere,
// and drops internal fields (__v, location).
const shapeAggregatedStation = (
  doc: Record<string, unknown>,
  chargingStationIds: Set<string>,
): StationPayload => {
  const { _id, __v, location: _loc, distanceMeters, ...rest } = doc as Record<
    string,
    unknown
  > & { distanceMeters?: number };
  void __v;
  void _loc;
  const id =
    _id != null ? String(_id) : typeof rest.id === "string" ? rest.id : "";
  const distanceKm =
    typeof distanceMeters === "number"
      ? Math.round((distanceMeters / 1000) * 100) / 100
      : undefined;
  return {
    ...rest,
    id,
    isChargingHere: id ? chargingStationIds.has(id) : false,
    ...(distanceKm !== undefined ? { distanceKm } : {}),
  };
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
  next: NextFunction,
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
      new HttpError("Both lat and lng query params are required.", 422),
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
        { station: 1 },
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
          500,
        ),
      );
    }
  }

  let stationsPayload: StationPayload[];

  if (hasLocation) {
    // DB-side proximity query using the 2dsphere index: only nearby stations are
    // read and sorted by distance in the database — never the whole collection.
    const maxResults =
      limit !== null ? Math.floor(limit) : DEFAULT_NEARBY_LIMIT;
    try {
      const geoPipeline: mongoose.PipelineStage[] = [
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [userLng as number, userLat as number],
            },
            distanceField: "distanceMeters",
            spherical: true,
            ...(radiusKm !== null ? { maxDistance: radiusKm * 1000 } : {}),
          },
        },
        { $limit: maxResults },
      ];
      const nearbyDocs = (await Station.aggregate(geoPipeline)) as Record<
        string,
        unknown
      >[];
      stationsPayload = nearbyDocs.map((doc) =>
        shapeAggregatedStation(doc, chargingStationIds),
      );
    } catch (err) {
      return next(
        new HttpError("Fetching stations failed, please try again later.", 500),
      );
    }

    // Always include stations where the user is actively charging, even if they
    // fall outside the search radius/limit.
    const presentIds = new Set(
      stationsPayload
        .map((s) => resolveStationId(s as Record<string, unknown>))
        .filter((id): id is string => Boolean(id)),
    );
    const missingChargingIds = [...chargingStationIds].filter(
      (id) => !presentIds.has(id),
    );
    if (missingChargingIds.length > 0) {
      try {
        const extraDocs = await Station.find({
          _id: { $in: missingChargingIds },
        });
        for (const station of extraDocs) {
          const snapshot = station.toObject({ getters: true }) as Record<
            string,
            unknown
          >;
          stationsPayload.push({ ...snapshot, isChargingHere: true });
        }
      } catch (err) {
        // Non-fatal — still return the nearby stations we already have.
      }
    }
  } else {
    // No location provided — return a bounded list (no proximity sort).
    let stations;
    try {
      stations = await Station.find({}, undefined, {
        limit: DEFAULT_LIST_LIMIT,
      });
    } catch (err) {
      return next(
        new HttpError("Fetching stations failed, please try again later.", 500),
      );
    }

    stationsPayload = stations.map((station) => {
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
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422),
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
      new HttpError("Fetching station failed, please try again later.", 500),
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
        { _id: 1 },
      ).lean();

      isChargingHere = Boolean(chargingTicket);
    } catch (err) {
      return next(
        new HttpError(
          "Fetching charging status failed, please try again later.",
          500,
        ),
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
