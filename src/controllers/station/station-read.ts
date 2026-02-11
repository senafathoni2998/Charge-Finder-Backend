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
  lng2: number,
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

/**
 * Generates a random coordinate within a specified radius from a center point
 * @param centerLat Center latitude
 * @param centerLng Center longitude
 * @param radiusKm Radius in kilometers
 * @returns Object with random latitude and longitude
 */
const generateRandomCoordinate = (
  centerLat: number,
  centerLng: number,
  radiusKm: number,
) => {
  // Convert radius from km to degrees (approximately)
  // 1 degree of latitude ≈ 111 km
  // 1 degree of longitude ≈ 111 km * cos(latitude)
  const radiusInDegreesLat = radiusKm / 111;

  // Generate random angle and distance within the radius
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.sqrt(Math.random()) * radiusInDegreesLat; // sqrt for uniform distribution

  const lat = centerLat + distance * Math.cos(angle);
  const lng =
    centerLng + (distance * Math.sin(angle)) / Math.cos(toRadians(centerLat));

  return { lat, lng };
};

/**
 * Generates demo stations with random coordinates within 20km
 * @param centerLat Optional center latitude for positioning stations
 * @param centerLng Optional center longitude for positioning stations
 * @param count Number of stations to generate
 * @returns Array of station objects
 */
const generateDemoStations = (
  centerLat: number | null,
  centerLng: number | null,
  count: number = 3,
) => {
  // Default to Jakarta coordinates if no center provided
  const defaultLat = -6.2088;
  const defaultLng = 106.8456;
  const baseLat = centerLat ?? defaultLat;
  const baseLng = centerLng ?? defaultLng;

  const stationNames = [
    "Fast Charge Hub",
    "EV Power Station",
    "Quick Charge Point",
    "Green Energy Charger",
    "Electrify Bay",
    "Volt Station",
    "Charge Mate",
    "Eco Power Hub",
  ];

  const addresses = [
    "Main Street District",
    "Central Avenue",
    "Park Boulevard",
    "City Center",
    "Green Valley Road",
    "Metro Plaza",
    "Riverside Drive",
    "Urban Junction",
  ];

  const connectorTypes: Array<"CCS2" | "Type2" | "CHAdeMO"> = [
    "CCS2",
    "Type2",
    "CHAdeMO",
  ];

  const statuses: Array<"AVAILABLE" | "BUSY" | "OFFLINE"> = [
    "AVAILABLE",
    "BUSY",
    "OFFLINE",
  ];

  const amenities = [
    ["Restroom", "Wi-Fi", "24/7"],
    ["Coffee", "Restroom", "Food court"],
    ["Wi-Fi", "Restroom", "Shopping"],
  ];

  const gradients = [
    "linear-gradient(135deg, rgba(124,92,255,0.55), rgba(0,229,255,0.35))",
    "linear-gradient(135deg, rgba(0,229,255,0.45), rgba(255,193,7,0.28))",
    "linear-gradient(135deg, rgba(255,193,7,0.34), rgba(244,67,54,0.22))",
  ];

  const stations = [];
  const usedCoordinates = new Set<string>();

  for (let i = 0; i < count; i++) {
    let coord: { lat: number; lng: number };
    let coordKey: string;

    // Ensure unique coordinates
    do {
      coord = generateRandomCoordinate(baseLat, baseLng, 20); // 20km radius
      coordKey = `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`;
    } while (usedCoordinates.has(coordKey));

    usedCoordinates.add(coordKey);

    const numConnectors = Math.floor(Math.random() * 2) + 2; // 2-3 connectors
    const connectors: Array<{
      type: "CCS2" | "Type2" | "CHAdeMO";
      powerKW: number;
      ports: number;
      availablePorts: number;
    }> = [];

    for (let j = 0; j < numConnectors; j++) {
      const type =
        connectorTypes[Math.floor(Math.random() * connectorTypes.length)];
      const existingTypes: string[] = connectors.map((c) => c.type);

      if (!existingTypes.includes(type)) {
        const powerKW = [22, 50, 60, 100, 150][Math.floor(Math.random() * 5)];
        const ports = Math.floor(Math.random() * 4) + 1;
        const availablePorts = Math.floor(Math.random() * (ports + 1));

        connectors.push({
          type,
          powerKW,
          ports,
          availablePorts,
        });
      }
    }

    const stationName =
      stationNames[Math.floor(Math.random() * stationNames.length)];
    const address = addresses[Math.floor(Math.random() * addresses.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    stations.push({
      name: `${stationName} ${i + 1}`,
      lat: coord.lat,
      lng: coord.lng,
      address: `${address}, Area ${i + 1}`,
      connectors,
      status,
      lastUpdatedISO: new Date().toISOString(),
      photos: [
        { label: "Entrance", gradient: gradients[0] },
        { label: "Bays", gradient: gradients[1] },
        { label: "Payment", gradient: gradients[2] },
      ],
      pricing: {
        currency: "IDR",
        perKwh: 2700 + Math.floor(Math.random() * 500),
        fastPerKwh: 3000 + Math.floor(Math.random() * 500),
        ultraFastPerKwh: 3300 + Math.floor(Math.random() * 500),
      },
      amenities: amenities[i % amenities.length],
      notes: "Demo station created for testing.",
    });
  }

  return stations;
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

  let stations;
  try {
    stations = await Station.find();
  } catch (err) {
    return next(
      new HttpError("Fetching stations failed, please try again later.", 500),
    );
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
            stationLng,
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
    // Preserve stations where user is currently charging before filtering
    const chargingStations: StationPayload[] = stationsPayload.filter(
      (station) => station.isChargingHere === true,
    );

    stationsPayload = stationsPayload.filter(
      (station) => typeof station.distanceKm === "number",
    );

    if (radiusKm !== null) {
      stationsPayload = stationsPayload.filter(
        (station) => (station.distanceKm ?? 0) <= radiusKm,
      );
    }

    stationsPayload.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    if (limit !== null) {
      stationsPayload = stationsPayload.slice(0, Math.floor(limit));
    }

    // Always include stations where user is charging, even if outside radius/limit
    for (const chargingStation of chargingStations) {
      if (
        !stationsPayload.some((s) => {
          const sid = resolveStationId(s as Record<string, unknown>);
          const csid = resolveStationId(
            chargingStation as Record<string, unknown>,
          );
          return sid && csid && sid === csid;
        })
      ) {
        // Add charging station to results (at the end to not interfere with sorted nearby stations)
        stationsPayload.push(chargingStation);
      }
    }
  }

  // Only create demo stations if database is completely empty
  if (!stationsPayload || stationsPayload.length === 0) {
    // Generate demo stations with random coordinates within 20km
    const demoStationsData = generateDemoStations(userLat, userLng, 3);

    try {
      // Save demo stations to MongoDB
      const createdStations = await Station.insertMany(demoStationsData);
      stationsPayload = createdStations.map((station) => {
        const stationSnapshot = station.toObject({ getters: true }) as Record<
          string,
          unknown
        >;
        const stationId = resolveStationId(stationSnapshot);
        const stationLat =
          typeof stationSnapshot.lat === "number" ? stationSnapshot.lat : null;
        const stationLng =
          typeof stationSnapshot.lng === "number" ? stationSnapshot.lng : null;
        const demoDistanceKm =
          hasLocation && stationLat !== null && stationLng !== null
            ? calculateDistanceKm(
                userLat as number,
                userLng as number,
                stationLat,
                stationLng,
              )
            : undefined;

        return {
          ...stationSnapshot,
          isChargingHere: false,
          ...(hasLocation && demoDistanceKm !== undefined
            ? { distanceKm: demoDistanceKm }
            : {}),
        };
      });

      // Sort demo stations by distance if location provided
      if (hasLocation) {
        stationsPayload.sort(
          (a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0),
        );
      }
    } catch (err) {
      return next(
        new HttpError(
          "Creating demo stations failed, please try again later.",
          500,
        ),
      );
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
