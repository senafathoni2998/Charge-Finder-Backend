import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../models/http-error";
import Station, { toGeoPoint } from "../../models/station";
import ChargingTicket from "../../models/charging-ticket";
import {
  getCachedJson,
  setCachedJson,
  stationByIdKey,
  stationGeoKey,
} from "../../services/station-cache";
import { config } from "../../config";

// First-time UX: when a user has no station near them AND demo data is enabled
// (config.enableDemoData — ON in demo/dev, OFF in production), seed one station per
// status near them so every status state is visible. Gated so this never writes on
// a GET at production scale.
const DEMO_STATUSES = ["AVAILABLE", "BUSY", "OFFLINE"] as const;
const DEMO_NAMES = ["Fast Charge Hub", "EV Power Station", "Quick Charge Point"];

const toRadians = (deg: number) => (deg * Math.PI) / 180;

// A random coordinate within radiusKm of a center (uniform over the disc).
const randomDemoCoordinate = (lat: number, lng: number, radiusKm: number) => {
  const radiusDeg = radiusKm / 111;
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.sqrt(Math.random()) * radiusDeg;
  return {
    lat: lat + distance * Math.cos(angle),
    lng: lng + (distance * Math.sin(angle)) / Math.cos(toRadians(lat)),
  };
};

// Builds exactly one demo station per status (AVAILABLE/BUSY/OFFLINE) near a center.
const buildDemoStations = (centerLat: number, centerLng: number) =>
  DEMO_STATUSES.map((status, i) => {
    const { lat, lng } = randomDemoCoordinate(centerLat, centerLng, 12);
    const availablePorts = status === "AVAILABLE" ? 2 : 0;
    return {
      name: `${DEMO_NAMES[i]} (Demo · ${status})`,
      lat,
      lng,
      location: toGeoPoint(lat, lng),
      address: `Demo location ${i + 1}`,
      status,
      connectors: [
        { type: "CCS2", powerKW: 50, ports: 2, availablePorts },
        { type: "Type2", powerKW: 22, ports: 2, availablePorts },
      ],
      pricing: { currency: "IDR", perKwh: 2700 },
      amenities: ["Restroom", "Wi-Fi"],
      photos: [
        {
          label: "Entrance",
          gradient:
            "linear-gradient(135deg, rgba(124,92,255,0.55), rgba(0,229,255,0.35))",
        },
      ],
      notes: "Demo station — shown so you can see each station status.",
      lastUpdatedISO: new Date().toISOString(),
    };
  });

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
    // The cached value is the raw geo result (no per-user data). The user-specific
    // isChargingHere flag is applied by shapeAggregatedStation after the cache read.
    const cacheKey = stationGeoKey(
      userLat as number,
      userLng as number,
      radiusKm,
      maxResults,
    );
    let nearbyDocs = await getCachedJson<Record<string, unknown>[]>(cacheKey);
    if (!nearbyDocs) {
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
        nearbyDocs = (await Station.aggregate(geoPipeline)) as Record<
          string,
          unknown
        >[];
        if (!nearbyDocs.length && config.enableDemoData) {
          // First-time user with nothing nearby — seed one station per status near
          // them, then re-run the geo query so they come back with distances. Only
          // runs in demo mode, so this is never a write on a GET at scale.
          await Station.insertMany(
            buildDemoStations(userLat as number, userLng as number),
          );
          nearbyDocs = (await Station.aggregate(geoPipeline)) as Record<
            string,
            unknown
          >[];
        }
        await setCachedJson(cacheKey, nearbyDocs);
      } catch (err) {
        return next(
          new HttpError(
            "Fetching stations failed, please try again later.",
            500,
          ),
        );
      }
    }
    stationsPayload = nearbyDocs.map((doc) =>
      shapeAggregatedStation(doc, chargingStationIds),
    );

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

  // Station data (without the per-user isChargingHere flag) is cached by id.
  let stationData = await getCachedJson<Record<string, unknown>>(
    stationByIdKey(stationId),
  );
  if (!stationData) {
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

    stationData = station.toObject({ getters: true }) as Record<
      string,
      unknown
    >;
    await setCachedJson(stationByIdKey(stationId), stationData);
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
      ...stationData,
      isChargingHere,
    },
  });
};

/**
 * Returns just a station's live connector availability (free/occupied ports) and
 * status.
 *
 * @purpose Powers the client's live-availability polling on the station detail page.
 * @caching Intentionally UNCACHED — reads the current connector counts straight from
 *   the DB. availablePorts changes on every start/complete/cancel-charging via the
 *   atomic port accounting (services/charging-ticket/persistence.ts), and the
 *   charging flow does not invalidate the 30s station cache, so a cached read would
 *   lag. This lean, fields-projected read is cheap enough to poll.
 * @params stationId - Station ID from the URL.
 * @returns { availability: { stationId, status, lastUpdatedISO, connectors:[{type,powerKW,ports,availablePorts}] } }
 */
const getStationAvailability = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { stationId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  let station;
  try {
    station = await Station.findById(stationId, {
      status: 1,
      lastUpdatedISO: 1,
      connectors: 1,
    }).lean();
  } catch (err) {
    return next(
      new HttpError(
        "Fetching availability failed, please try again later.",
        500,
      ),
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  const connectors = Array.isArray(station.connectors)
    ? station.connectors.map((connector) => {
        const ports = Math.max(0, Number(connector.ports) || 0);
        // Clamp to [0, ports] so the availability API never reports a nonsensical
        // count (e.g. availablePorts > ports), which would make the client's
        // "in use = ports - availablePorts" go negative. This is defensive against
        // rare over-release on stations misconfigured with duplicate connector types.
        const availablePorts = Math.min(
          Math.max(0, Number(connector.availablePorts) || 0),
          ports,
        );
        return { type: connector.type, powerKW: connector.powerKW, ports, availablePorts };
      })
    : [];

  res.status(200).json({
    availability: {
      stationId: String(station._id),
      status: station.status,
      lastUpdatedISO: station.lastUpdatedISO,
      connectors,
    },
  });
};

export { getStations, getStationById, getStationAvailability };
