import {
  haversineKm,
  pointToSegmentKm,
  type LatLng,
} from "../utils/geo";

// Planner tuning / product defaults. Overridable per-request in the controller.
export const TRIP_DEFAULTS = {
  EFFICIENCY_KWH_PER_100KM: 18, // ~typical EV consumption
  BUFFER_PERCENT: 10, // always keep this much charge in reserve
  CHARGE_TO_PERCENT: 80, // assumed recharge target at each stop (fast-charge sweet spot)
  MAX_DETOUR_KM: 25, // how far off the direct line a candidate station may sit
  MAX_STOPS: 50, // hard cap on stops (also bounds search depth)
  MIN_PROGRESS_KM: 1, // each stop must get at least this much closer (guarantees termination)
  // Search bounds: at each stop we try the FANOUT best candidates and backtrack on a
  // dead-end, up to MAX_NODES expanded states — enough to recover from the greedy trap
  // (a nearer stop leading to a viable chain) while keeping worst-case work bounded.
  FANOUT: 5,
  MAX_NODES: 4000,
};

export type PlanStationConnector = { type: string; powerKW: number };
export type PlanStation = {
  id: string;
  name?: string;
  address?: string;
  lat: number;
  lng: number;
  connectors: PlanStationConnector[];
};

export type PlanParams = {
  origin: LatLng;
  destination: LatLng;
  fullRangeKm: number;
  startBatteryPercent: number;
  bufferPercent: number;
  chargeToPercent: number;
  allowedConnectorTypes: string[];
  minPowerKW: number;
  maxDetourKm: number;
  maxStops?: number;
};

export type PlanStop = {
  station: { id: string; name?: string; address?: string; lat: number; lng: number };
  connectorType: string;
  powerKW: number;
  distanceFromPrevKm: number;
  cumulativeKm: number;
  detourKm: number;
  arrivalBatteryPercent: number;
  departBatteryPercent: number;
};

export type PlanLeg = {
  from: LatLng & { label: string };
  to: LatLng & { label: string };
  distanceKm: number;
  arrivalBatteryPercent: number;
};

export type TripPlan = {
  feasible: boolean;
  reason?: string;
  directDistanceKm: number;
  totalDistanceKm: number;
  totalStops: number;
  reserveKm: number;
  usableStartKm: number;
  perStopUsableKm: number;
  stops: PlanStop[];
  legs: PlanLeg[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPercent = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Range (km) at 100% battery, derived from usable capacity (kWh) and consumption
 * (kWh/100km). Returns null when inputs are unusable.
 */
export const deriveRangeKm = (
  batteryCapacityKwh: number,
  efficiencyKwhPer100Km: number
): number | null => {
  if (
    !Number.isFinite(batteryCapacityKwh) ||
    batteryCapacityKwh <= 0 ||
    !Number.isFinite(efficiencyKwhPer100Km) ||
    efficiencyKwhPer100Km <= 0
  ) {
    return null;
  }
  return (batteryCapacityKwh * 100) / efficiencyKwhPer100Km;
};

// Best compatible connector at a station (highest power meeting the constraints), or null.
const selectConnector = (
  station: PlanStation,
  allowedTypes: string[],
  minPowerKW: number
): PlanStationConnector | null => {
  if (!Array.isArray(station.connectors)) {
    return null;
  }
  let best: PlanStationConnector | null = null;
  for (const c of station.connectors) {
    if (!c || typeof c.powerKW !== "number") {
      continue;
    }
    if (allowedTypes.length > 0 && !allowedTypes.includes(c.type)) {
      continue;
    }
    if (c.powerKW < minPowerKW) {
      continue;
    }
    if (!best || c.powerKW > best.powerKW) {
      best = { type: c.type, powerKW: c.powerKW };
    }
  }
  return best;
};

const percentForKm = (km: number, fullRangeKm: number) =>
  fullRangeKm > 0 ? (km / fullRangeKm) * 100 : 0;

type Candidate = {
  station: PlanStation;
  connector: PlanStationConnector;
  point: LatLng;
  reachKm: number;
  remainingKm: number;
  detourKm: number;
};

/**
 * Plans a range-aware trip: inserts charging stops (chosen from `stations`) so every
 * leg stays within the vehicle's usable range and it always keeps `bufferPercent` in
 * reserve.
 *
 * Search: at each stop the reachable, corridor-eligible, progress-making stations are
 * ranked (farthest progress first, then smaller detour, then more power); the planner
 * explores the FANOUT best and BACKTRACKS on a dead-end, bounded by MAX_NODES. So —
 * unlike a pure greedy — a feasible route is found even when the most aggressive first
 * stop dead-ends. The strict progress requirement (each stop >= MIN_PROGRESS_KM closer)
 * plus the depth/node bounds guarantee termination.
 *
 * Pure: candidate stations are supplied by the caller (the controller does the geo
 * query). Returns a feasible plan or `{ feasible: false, reason }`.
 */
export const planTrip = (
  params: PlanParams,
  stations: PlanStation[]
): TripPlan => {
  const {
    origin,
    destination,
    fullRangeKm,
    startBatteryPercent,
    bufferPercent,
    chargeToPercent,
    allowedConnectorTypes,
    minPowerKW,
    maxDetourKm,
  } = params;

  const maxStops = Math.max(
    0,
    Math.floor(params.maxStops ?? TRIP_DEFAULTS.MAX_STOPS)
  );
  const { MIN_PROGRESS_KM, FANOUT, MAX_NODES } = TRIP_DEFAULTS;

  const reserveKm = fullRangeKm * (bufferPercent / 100);
  const usableStartKm = fullRangeKm * (startBatteryPercent / 100) - reserveKm;
  const perStopUsableKm = fullRangeKm * (chargeToPercent / 100) - reserveKm;
  const directDistanceKm = haversineKm(origin, destination);

  const base: Omit<TripPlan, "feasible" | "reason"> = {
    directDistanceKm: round2(directDistanceKm),
    totalDistanceKm: 0,
    totalStops: 0,
    reserveKm: round2(reserveKm),
    usableStartKm: round2(usableStartKm),
    perStopUsableKm: round2(perStopUsableKm),
    stops: [],
    legs: [],
  };
  const infeasible = (reason: string): TripPlan => ({ ...base, feasible: false, reason });

  // Trivial: same place.
  if (directDistanceKm === 0) {
    return { ...base, feasible: true, totalDistanceKm: 0, totalStops: 0 };
  }
  // Can we even leave the origin toward anything useful?
  if (usableStartKm <= 0) {
    return infeasible(
      "Starting charge does not clear the reserve buffer — charge before departing."
    );
  }

  // Candidates reachable from `current` on `usableNow` km that get strictly closer and
  // stay within the corridor. Ranked best-first.
  const candidatesFrom = (
    current: LatLng,
    usableNow: number,
    visited: Set<string>
  ): Candidate[] => {
    const distToDest = haversineKm(current, destination);
    const out: Candidate[] = [];
    for (const station of stations) {
      if (visited.has(station.id)) continue;
      const connector = selectConnector(station, allowedConnectorTypes, minPowerKW);
      if (!connector) continue;
      const point: LatLng = { lat: station.lat, lng: station.lng };
      const reachKm = haversineKm(current, point);
      if (reachKm > usableNow) continue;
      const remainingKm = haversineKm(point, destination);
      if (remainingKm > distToDest - MIN_PROGRESS_KM) continue;
      const detourKm = pointToSegmentKm(point, origin, destination);
      if (detourKm > maxDetourKm) continue;
      out.push({ station, connector, point, reachKm, remainingKm, detourKm });
    }
    out.sort(
      (a, b) =>
        a.remainingKm - b.remainingKm ||
        a.detourKm - b.detourKm ||
        b.connector.powerKW - a.connector.powerKW
    );
    return out;
  };

  type SearchResult = { stops: PlanStop[]; legs: PlanLeg[]; cumulativeKm: number };

  const budget = { nodes: 0, hitLimit: false };

  const search = (
    current: LatLng,
    currentLabel: string,
    usableNow: number,
    batteryPercent: number,
    cumulativeKm: number,
    visited: Set<string>,
    depth: number
  ): SearchResult | null => {
    const distToDest = haversineKm(current, destination);

    // Destination in range → final leg, done.
    if (distToDest <= usableNow) {
      const arrival = clampPercent(
        batteryPercent - percentForKm(distToDest, fullRangeKm)
      );
      return {
        stops: [],
        legs: [
          {
            from: { ...current, label: currentLabel },
            to: { ...destination, label: "destination" },
            distanceKm: round2(distToDest),
            arrivalBatteryPercent: round1(arrival),
          },
        ],
        cumulativeKm: cumulativeKm + distToDest,
      };
    }

    if (depth >= maxStops) return null; // out of stop budget on this path
    if (perStopUsableKm <= MIN_PROGRESS_KM) return null; // a full charge can't advance
    if (budget.nodes >= MAX_NODES) {
      budget.hitLimit = true;
      return null;
    }
    budget.nodes += 1;

    const candidates = candidatesFrom(current, usableNow, visited).slice(0, FANOUT);
    for (const c of candidates) {
      const arrival = clampPercent(
        batteryPercent - percentForKm(c.reachKm, fullRangeKm)
      );
      const nextVisited = new Set(visited);
      nextVisited.add(c.station.id);
      const sub = search(
        c.point,
        c.station.name ?? c.station.id,
        perStopUsableKm,
        chargeToPercent,
        cumulativeKm + c.reachKm,
        nextVisited,
        depth + 1
      );
      if (sub) {
        const stop: PlanStop = {
          station: {
            id: c.station.id,
            name: c.station.name,
            address: c.station.address,
            lat: c.station.lat,
            lng: c.station.lng,
          },
          connectorType: c.connector.type,
          powerKW: c.connector.powerKW,
          distanceFromPrevKm: round2(c.reachKm),
          cumulativeKm: round2(cumulativeKm + c.reachKm),
          detourKm: round2(c.detourKm),
          arrivalBatteryPercent: round1(arrival),
          departBatteryPercent: round1(chargeToPercent),
        };
        const leg: PlanLeg = {
          from: { ...current, label: currentLabel },
          to: { ...c.point, label: c.station.name ?? c.station.id },
          distanceKm: round2(c.reachKm),
          arrivalBatteryPercent: round1(arrival),
        };
        return {
          stops: [stop, ...sub.stops],
          legs: [leg, ...sub.legs],
          cumulativeKm: sub.cumulativeKm,
        };
      }
    }
    return null;
  };

  const result = search(
    origin,
    "origin",
    usableStartKm,
    startBatteryPercent,
    0,
    new Set<string>(),
    0
  );

  if (!result) {
    if (perStopUsableKm <= MIN_PROGRESS_KM) {
      return infeasible(
        "Charge target does not clear the reserve buffer by enough to make progress — raise chargeToPercent or lower bufferPercent."
      );
    }
    if (budget.hitLimit) {
      return infeasible(
        "Route search hit its complexity limit before finding a route — narrow the corridor or tighten constraints and try again."
      );
    }
    return infeasible(
      "No feasible route found within the range, corridor and connector constraints. " +
        "Try a larger detour, a lower minimum power, more connector types, or a higher charge target."
    );
  }

  return {
    ...base,
    feasible: true,
    totalDistanceKm: round2(result.cumulativeKm),
    totalStops: result.stops.length,
    stops: result.stops,
    legs: result.legs,
  };
};
