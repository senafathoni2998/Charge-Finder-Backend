import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../models/http-error";
import Station from "../models/station";
import Vehicle from "../models/vehicle";
import Trip from "../models/trip";
import { haversineKm, isValidLatLng, type LatLng } from "../utils/geo";
import {
  planTrip,
  deriveRangeKm,
  TRIP_DEFAULTS,
  type PlanStation,
  type TripPlan,
} from "../services/trip-planner-service";

type SessionReq = Request & {
  user?: { id: string; role?: "admin" | "user" };
};

const CONNECTOR_TYPES = ["CCS2", "Type2", "CHAdeMO"];
// Bound the candidate-station geo query so a very long trip can't scan the world.
const MAX_CANDIDATE_STATIONS = 1000;

const resolveSessionUser = (req: SessionReq) => {
  const user = req.user ?? req.session?.user;
  return { id: user?.id, isAdmin: user?.role === "admin" };
};

const parsePoint = (raw: unknown): (LatLng & { label?: string }) | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { lat, lng, label } = raw as {
    lat?: unknown;
    lng?: unknown;
    label?: unknown;
  };
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!isValidLatLng(point)) {
    return null;
  }
  return typeof label === "string" ? { ...point, label } : point;
};

const asNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

type ResolvedInputs = {
  origin: LatLng & { label?: string };
  destination: LatLng & { label?: string };
  vehicleId?: string;
  fullRangeKm: number;
  startBatteryPercent: number;
  bufferPercent: number;
  chargeToPercent: number;
  minPowerKW: number;
  maxDetourKm: number;
  allowedConnectorTypes: string[];
  efficiencyKwhPer100Km: number;
};

// Resolves origin/destination and the planning parameters, filling defaults from the
// vehicle when one is supplied. Returns an HttpError to forward, or the inputs.
const resolvePlanInputs = async (
  req: SessionReq,
  userId: string
): Promise<{ error: HttpError } | { inputs: ResolvedInputs }> => {
  const body = req.body ?? {};

  const origin = parsePoint(body.origin);
  const destination = parsePoint(body.destination);
  if (!origin || !destination) {
    return { error: new HttpError("Valid origin and destination { lat, lng } are required.", 422) };
  }

  const { vehicleId } = body;
  if (vehicleId !== undefined && !mongoose.Types.ObjectId.isValid(vehicleId)) {
    return { error: new HttpError("Invalid vehicle id.", 422) };
  }

  let vehicle: Record<string, unknown> | null = null;
  if (vehicleId !== undefined) {
    vehicle = (await Vehicle.findById(vehicleId).lean()) as Record<
      string,
      unknown
    > | null;
    if (!vehicle) {
      return { error: new HttpError("Vehicle not found.", 404) };
    }
    if (String(vehicle.owner) !== String(userId)) {
      return { error: new HttpError("You do not own this vehicle.", 403) };
    }
  }

  const efficiencyKwhPer100Km =
    asNumber(body.efficiencyKwhPer100Km) ??
    TRIP_DEFAULTS.EFFICIENCY_KWH_PER_100KM;

  // Range: explicit rangeKm wins; otherwise derive from the vehicle's battery capacity.
  const explicitRange = asNumber(body.rangeKm);
  let fullRangeKm: number | null = null;
  if (explicitRange !== undefined && explicitRange > 0) {
    fullRangeKm = explicitRange;
  } else if (vehicle && typeof vehicle.batteryCapacity === "number") {
    fullRangeKm = deriveRangeKm(vehicle.batteryCapacity, efficiencyKwhPer100Km);
  }
  if (fullRangeKm === null || fullRangeKm <= 0) {
    return {
      error: new HttpError(
        "Cannot determine range — provide rangeKm, or a vehicleId whose battery capacity is known.",
        422
      ),
    };
  }

  const startBatteryPercent =
    asNumber(body.startBatteryPercent) ??
    (typeof vehicle?.batteryPercent === "number"
      ? (vehicle.batteryPercent as number)
      : 100);

  const bufferPercent =
    asNumber(body.bufferPercent) ?? TRIP_DEFAULTS.BUFFER_PERCENT;
  const chargeToPercent =
    asNumber(body.chargeToPercent) ?? TRIP_DEFAULTS.CHARGE_TO_PERCENT;
  const maxDetourKm =
    asNumber(body.maxDetourKm) ?? TRIP_DEFAULTS.MAX_DETOUR_KM;

  const minPowerKW =
    asNumber(body.minPowerKW) ??
    (typeof vehicle?.min_power === "number" ? (vehicle.min_power as number) : 0);

  // Restrict to the known connector types and dedupe (only 3 exist) so a caller can't
  // inflate the array to amplify the planner's per-station connector scan.
  let allowedConnectorTypes: string[] = [];
  if (Array.isArray(body.connectorTypes)) {
    allowedConnectorTypes = [
      ...new Set(
        (body.connectorTypes as unknown[]).filter((t) =>
          CONNECTOR_TYPES.includes(t as string)
        ) as string[]
      ),
    ];
  } else if (Array.isArray(vehicle?.connector_type)) {
    allowedConnectorTypes = [
      ...new Set(
        (vehicle!.connector_type as unknown[]).filter((t) =>
          CONNECTOR_TYPES.includes(t as string)
        ) as string[]
      ),
    ];
  }

  // Guard against a charge target that can never clear the reserve.
  if (chargeToPercent <= bufferPercent) {
    return {
      error: new HttpError(
        "chargeToPercent must be greater than bufferPercent.",
        422
      ),
    };
  }

  return {
    inputs: {
      origin,
      destination,
      vehicleId,
      fullRangeKm,
      startBatteryPercent: Math.max(0, Math.min(100, startBatteryPercent)),
      bufferPercent,
      chargeToPercent,
      minPowerKW,
      maxDetourKm,
      allowedConnectorTypes,
      efficiencyKwhPer100Km,
    },
  };
};

const toPlanStation = (doc: Record<string, unknown>): PlanStation => ({
  id: String(doc._id),
  name: typeof doc.name === "string" ? doc.name : undefined,
  address: typeof doc.address === "string" ? doc.address : undefined,
  lat: doc.lat as number,
  lng: doc.lng as number,
  connectors: Array.isArray(doc.connectors)
    ? (doc.connectors as Record<string, unknown>[]).map((c) => ({
        type: String(c.type),
        powerKW: typeof c.powerKW === "number" ? c.powerKW : 0,
      }))
    : [],
});

const geoNearWithin = (center: LatLng, radiusKm: number, limit: number) =>
  Station.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [center.lng, center.lat] },
        distanceField: "distanceMeters",
        spherical: true,
        maxDistance: radiusKm * 1000,
      },
    },
    { $limit: limit },
  ]) as unknown as Promise<Record<string, unknown>[]>;

// Fetches candidate stations along the corridor via the 2dsphere index. Because $geoNear
// returns nearest-first and $limit keeps the nearest, anchoring on a single point would
// silently drop the *farthest* corridor stations — exactly the range-critical first/last
// hops. So we anchor on BOTH endpoints (each query radius covers the whole corridor) and
// union the results, guaranteeing near-origin and near-destination candidates survive.
const fetchCorridorStations = async (
  origin: LatLng,
  destination: LatLng,
  maxDetourKm: number
): Promise<PlanStation[]> => {
  const directKm = haversineKm(origin, destination);
  const radiusKm = directKm + maxDetourKm + 5; // from either endpoint, covers the corridor

  const [fromOrigin, fromDestination] = await Promise.all([
    geoNearWithin(origin, radiusKm, MAX_CANDIDATE_STATIONS),
    geoNearWithin(destination, radiusKm, MAX_CANDIDATE_STATIONS),
  ]);

  const byId = new Map<string, PlanStation>();
  for (const doc of [...fromOrigin, ...fromDestination]) {
    const station = toPlanStation(doc);
    byId.set(station.id, station);
  }
  return [...byId.values()];
};

// Shapes a saved Trip (lean or hydrated) into the API payload: `_id`→`id`, drops the
// internal `_id`/`__v`, matching the reservation/station payload convention.
const buildTripPayload = (trip: Record<string, unknown>): Record<string, unknown> => {
  const { _id, __v, ...rest } = trip as Record<string, unknown> & {
    _id?: unknown;
    __v?: unknown;
  };
  void __v;
  return { id: String(_id ?? rest.id ?? ""), ...rest };
};

// Assembles the full plan object returned to the client / persisted.
const buildPlanResponse = (inputs: ResolvedInputs, plan: TripPlan) => ({
  feasible: plan.feasible,
  ...(plan.reason ? { reason: plan.reason } : {}),
  origin: inputs.origin,
  destination: inputs.destination,
  ...(inputs.vehicleId ? { vehicleId: inputs.vehicleId } : {}),
  params: {
    fullRangeKm: Math.round(inputs.fullRangeKm * 100) / 100,
    startBatteryPercent: inputs.startBatteryPercent,
    bufferPercent: inputs.bufferPercent,
    chargeToPercent: inputs.chargeToPercent,
    minPowerKW: inputs.minPowerKW,
    maxDetourKm: inputs.maxDetourKm,
    allowedConnectorTypes: inputs.allowedConnectorTypes,
    efficiencyKwhPer100Km: inputs.efficiencyKwhPer100Km,
  },
  directDistanceKm: plan.directDistanceKm,
  totalDistanceKm: plan.totalDistanceKm,
  totalStops: plan.totalStops,
  reserveKm: plan.reserveKm,
  usableStartKm: plan.usableStartKm,
  perStopUsableKm: plan.perStopUsableKm,
  stops: plan.stops,
  legs: plan.legs,
});

const runPlan = async (
  req: SessionReq,
  userId: string
): Promise<
  | { error: HttpError }
  | { inputs: ResolvedInputs; plan: TripPlan }
> => {
  const resolved = await resolvePlanInputs(req, userId);
  if ("error" in resolved) {
    return resolved;
  }
  const { inputs } = resolved;

  // Same-point trips need no stations; skip the geo query.
  const stations =
    haversineKm(inputs.origin, inputs.destination) === 0
      ? []
      : await fetchCorridorStations(
          inputs.origin,
          inputs.destination,
          inputs.maxDetourKm
        );

  const plan = planTrip(
    {
      origin: inputs.origin,
      destination: inputs.destination,
      fullRangeKm: inputs.fullRangeKm,
      startBatteryPercent: inputs.startBatteryPercent,
      bufferPercent: inputs.bufferPercent,
      chargeToPercent: inputs.chargeToPercent,
      allowedConnectorTypes: inputs.allowedConnectorTypes,
      minPowerKW: inputs.minPowerKW,
      maxDetourKm: inputs.maxDetourKm,
    },
    stations
  );

  return { inputs, plan };
};

/**
 * Computes a range-aware trip plan (stateless — nothing is saved).
 *
 * @authentication Required.
 * @body origin{lat,lng}, destination{lat,lng}, and either vehicleId or rangeKm; optional
 *   startBatteryPercent, bufferPercent, chargeToPercent, minPowerKW, maxDetourKm,
 *   connectorTypes[], efficiencyKwhPer100Km.
 */
const planTripHandler = async (
  req: SessionReq,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new HttpError("Invalid inputs passed, please check your data.", 422));
  }
  const { id: userId } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let result;
  try {
    result = await runPlan(req, userId);
  } catch (err) {
    return next(new HttpError("Planning trip failed, please try again later.", 500));
  }
  if ("error" in result) {
    return next(result.error);
  }

  res.status(200).json({ plan: buildPlanResponse(result.inputs, result.plan) });
};

/**
 * Computes a plan and saves it for the user. Only feasible plans can be saved.
 *
 * @authentication Required.
 */
const saveTrip = async (req: SessionReq, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new HttpError("Invalid inputs passed, please check your data.", 422));
  }
  const { id: userId } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let result;
  try {
    result = await runPlan(req, userId);
  } catch (err) {
    return next(new HttpError("Planning trip failed, please try again later.", 500));
  }
  if ("error" in result) {
    return next(result.error);
  }

  const { inputs, plan } = result;
  if (!plan.feasible) {
    return next(
      new HttpError(plan.reason ?? "Trip is not feasible and cannot be saved.", 422)
    );
  }

  const name = typeof req.body?.name === "string" ? req.body.name : undefined;

  let trip;
  try {
    trip = new Trip({
      user: userId,
      ...(inputs.vehicleId ? { vehicle: inputs.vehicleId } : {}),
      ...(name ? { name } : {}),
      origin: inputs.origin,
      destination: inputs.destination,
      fullRangeKm: inputs.fullRangeKm,
      startBatteryPercent: inputs.startBatteryPercent,
      bufferPercent: inputs.bufferPercent,
      chargeToPercent: inputs.chargeToPercent,
      minPowerKW: inputs.minPowerKW,
      maxDetourKm: inputs.maxDetourKm,
      allowedConnectorTypes: inputs.allowedConnectorTypes,
      feasible: plan.feasible,
      directDistanceKm: plan.directDistanceKm,
      totalDistanceKm: plan.totalDistanceKm,
      totalStops: plan.totalStops,
      stops: plan.stops.map((s) => ({
        station: mongoose.Types.ObjectId.isValid(s.station.id)
          ? s.station.id
          : undefined,
        name: s.station.name,
        address: s.station.address,
        lat: s.station.lat,
        lng: s.station.lng,
        connectorType: s.connectorType,
        powerKW: s.powerKW,
        distanceFromPrevKm: s.distanceFromPrevKm,
        cumulativeKm: s.cumulativeKm,
        arrivalBatteryPercent: s.arrivalBatteryPercent,
        departBatteryPercent: s.departBatteryPercent,
      })),
    });
    await trip.save();
  } catch (err) {
    return next(new HttpError("Saving trip failed, please try again.", 500));
  }

  res.status(201).json({
    message: "Trip saved.",
    trip: buildTripPayload(trip.toObject({ getters: true }) as Record<string, unknown>),
    plan: buildPlanResponse(inputs, plan),
  });
};

/**
 * Lists the caller's saved trips, newest first.
 * @authentication Required.
 */
const getMyTrips = async (req: SessionReq, res: Response, next: NextFunction) => {
  const { id: userId } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  let trips;
  try {
    trips = await Trip.find({ user: userId }).sort({ createdAt: -1 }).lean();
  } catch (err) {
    return next(new HttpError("Fetching trips failed, please try again later.", 500));
  }

  res.status(200).json({
    trips: trips.map((t) => buildTripPayload(t as Record<string, unknown>)),
  });
};

/**
 * Returns a single saved trip. Owner or admin only.
 * @authentication Required.
 */
const getTripById = async (req: SessionReq, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new HttpError("Invalid inputs passed, please check your data.", 422));
  }
  const { id: userId, isAdmin } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { tripId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(tripId)) {
    return next(new HttpError("Invalid trip id.", 422));
  }

  let trip;
  try {
    trip = await Trip.findById(tripId).lean();
  } catch (err) {
    return next(new HttpError("Fetching trip failed, please try again later.", 500));
  }
  if (!trip) {
    return next(new HttpError("Trip not found.", 404));
  }
  if (!isAdmin && String((trip as { user?: unknown }).user) !== String(userId)) {
    return next(new HttpError("Forbidden.", 403));
  }

  res.status(200).json({ trip: buildTripPayload(trip as Record<string, unknown>) });
};

/**
 * Deletes a saved trip. Owner or admin only.
 * @authentication Required.
 */
const deleteTrip = async (req: SessionReq, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new HttpError("Invalid inputs passed, please check your data.", 422));
  }
  const { id: userId, isAdmin } = resolveSessionUser(req);
  if (!userId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { tripId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(tripId)) {
    return next(new HttpError("Invalid trip id.", 422));
  }

  let trip;
  try {
    trip = await Trip.findById(tripId);
  } catch (err) {
    return next(new HttpError("Deleting trip failed, please try again.", 500));
  }
  if (!trip) {
    return next(new HttpError("Trip not found.", 404));
  }
  if (!isAdmin && String(trip.get("user")) !== String(userId)) {
    return next(new HttpError("Forbidden.", 403));
  }

  try {
    await trip.deleteOne();
  } catch (err) {
    return next(new HttpError("Deleting trip failed, please try again.", 500));
  }

  res.status(200).json({ message: "Trip deleted." });
};

export {
  planTripHandler,
  saveTrip,
  getMyTrips,
  getTripById,
  deleteTrip,
};
