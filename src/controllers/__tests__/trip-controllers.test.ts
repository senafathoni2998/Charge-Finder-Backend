import {
  planTripHandler,
  saveTrip,
  getMyTrips,
  getTripById,
  deleteTrip,
} from "../trip-controllers";
import Station from "../../models/station";
import Vehicle from "../../models/vehicle";
import Trip from "../../models/trip";
import { validationResult } from "express-validator";
import { planTrip, deriveRangeKm } from "../../services/trip-planner-service";

jest.mock("express-validator", () => ({ validationResult: jest.fn() }));

jest.mock("../../models/station", () => ({
  __esModule: true,
  default: { aggregate: jest.fn() },
}));
jest.mock("../../models/vehicle", () => {
  const M = jest.fn() as jest.Mock & { findById: jest.Mock };
  M.findById = jest.fn();
  return { __esModule: true, default: M };
});
jest.mock("../../models/trip", () => {
  const M = jest.fn() as jest.Mock & { find: jest.Mock; findById: jest.Mock };
  M.find = jest.fn();
  M.findById = jest.fn();
  return { __esModule: true, default: M };
});
jest.mock("../../services/trip-planner-service", () => ({
  planTrip: jest.fn(),
  deriveRangeKm: jest.fn(),
  TRIP_DEFAULTS: {
    EFFICIENCY_KWH_PER_100KM: 18,
    BUFFER_PERCENT: 10,
    CHARGE_TO_PERCENT: 80,
    MAX_DETOUR_KM: 25,
    MAX_STOPS: 50,
    MIN_PROGRESS_KM: 1,
  },
}));

const StationMock = Station as unknown as { aggregate: jest.Mock };
const VehicleMock = Vehicle as unknown as jest.Mock & { findById: jest.Mock };
const TripMock = Trip as unknown as jest.Mock & {
  find: jest.Mock;
  findById: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const planTripMock = planTrip as jest.Mock;
const deriveRangeMock = deriveRangeKm as jest.Mock;

type MockResponse = { status: jest.Mock; json: jest.Mock };
const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const VALID_VEHICLE = "507f1f77bcf86cd799439012";
const VALID_TRIP = "507f1f77bcf86cd799439013";

const feasiblePlan = () => ({
  feasible: true,
  directDistanceKm: 111,
  totalDistanceKm: 111,
  totalStops: 0,
  reserveKm: 30,
  usableStartKm: 270,
  perStopUsableKm: 210,
  stops: [],
  legs: [{ from: { lat: 0, lng: 0, label: "origin" }, to: { lat: 0, lng: 1, label: "destination" }, distanceKm: 111, arrivalBatteryPercent: 63 }],
});

const lean = (resolved: unknown) => ({ lean: jest.fn(() => Promise.resolve(resolved)) });

beforeEach(() => {
  jest.clearAllMocks();
  validationResultMock.mockReturnValue({ isEmpty: () => true });
  StationMock.aggregate.mockResolvedValue([]);
  planTripMock.mockReturnValue(feasiblePlan());
  deriveRangeMock.mockReturnValue(333);
});

const planBody = (over: Record<string, unknown> = {}) => ({
  origin: { lat: 0, lng: 0 },
  destination: { lat: 0, lng: 1 },
  rangeKm: 300,
  ...over,
});

describe("planTripHandler", () => {
  it("422 when validation fails", async () => {
    validationResultMock.mockReturnValue({ isEmpty: () => false });
    const next = jest.fn();
    await planTripHandler({ user: { id: "u1" }, body: planBody() } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("401 when unauthenticated", async () => {
    const next = jest.fn();
    await planTripHandler({ session: {}, body: planBody() } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("422 when origin/destination are missing or invalid", async () => {
    const next = jest.fn();
    await planTripHandler({ user: { id: "u1" }, body: { rangeKm: 300 } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("422 when range cannot be determined (no rangeKm, no vehicle)", async () => {
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: { origin: { lat: 0, lng: 0 }, destination: { lat: 0, lng: 1 } } } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("422 when chargeToPercent <= bufferPercent", async () => {
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: planBody({ chargeToPercent: 10, bufferPercent: 10 }) } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("404 when a supplied vehicle does not exist", async () => {
    VehicleMock.findById.mockReturnValue(lean(null));
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: planBody({ rangeKm: undefined, vehicleId: VALID_VEHICLE }) } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when the vehicle is not owned by the caller", async () => {
    VehicleMock.findById.mockReturnValue(lean({ owner: "other", batteryCapacity: 60 }));
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: planBody({ rangeKm: undefined, vehicleId: VALID_VEHICLE }) } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("derives range and constraints from the vehicle", async () => {
    VehicleMock.findById.mockReturnValue(
      lean({ owner: "u1", batteryCapacity: 60, batteryPercent: 80, connector_type: ["CCS2"], min_power: 50 })
    );
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: { origin: { lat: 0, lng: 0 }, destination: { lat: 0, lng: 1 }, vehicleId: VALID_VEHICLE } } as any,
      buildRes() as any,
      next
    );
    expect(deriveRangeMock).toHaveBeenCalledWith(60, 18);
    const params = planTripMock.mock.calls[0][0];
    expect(params.fullRangeKm).toBe(333);
    expect(params.startBatteryPercent).toBe(80);
    expect(params.allowedConnectorTypes).toEqual(["CCS2"]);
    expect(params.minPowerKW).toBe(50);
  });

  it("200 with the plan on success", async () => {
    const res = buildRes();
    const next = jest.fn();
    await planTripHandler({ user: { id: "u1" }, body: planBody() } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].plan.feasible).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("200 with an infeasible plan (does not error)", async () => {
    planTripMock.mockReturnValue({ ...feasiblePlan(), feasible: false, reason: "no way" });
    const res = buildRes();
    const next = jest.fn();
    await planTripHandler({ user: { id: "u1" }, body: planBody({ destination: { lat: 0, lng: 8 } }) } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].plan.feasible).toBe(false);
    expect(res.json.mock.calls[0][0].plan.reason).toBe("no way");
  });

  it("skips the station query for a same-point trip", async () => {
    const next = jest.fn();
    await planTripHandler({ user: { id: "u1" }, body: planBody({ destination: { lat: 0, lng: 0 } }) } as any, buildRes() as any, next);
    expect(StationMock.aggregate).not.toHaveBeenCalled();
    expect(planTripMock).toHaveBeenCalled();
  });

  it("fetches corridor stations via two $geoNear queries and maps/dedupes them", async () => {
    StationMock.aggregate
      .mockResolvedValueOnce([
        { _id: "s1", name: "A", address: "addr", lat: 0, lng: 2, connectors: [{ type: "CCS2", powerKW: 100 }] },
        { _id: "s2", name: "B", lat: 0, lng: 3, connectors: [] },
      ])
      .mockResolvedValueOnce([
        { _id: "s2", name: "B", lat: 0, lng: 3, connectors: [] },
        { _id: "s3", name: "C", lat: 0, lng: 4, connectors: [{ type: "Type2", powerKW: 22 }] },
      ]);
    const next = jest.fn();
    await planTripHandler(
      { user: { id: "u1" }, body: planBody({ destination: { lat: 0, lng: 5 } }) } as any,
      buildRes() as any,
      next
    );

    // Anchored on both endpoints so endpoint candidates aren't truncated.
    expect(StationMock.aggregate).toHaveBeenCalledTimes(2);
    const pipeline = StationMock.aggregate.mock.calls[0][0];
    expect(pipeline[0].$geoNear).toBeDefined();
    expect(pipeline[1].$limit).toBeDefined();

    const stations = planTripMock.mock.calls[0][1];
    expect(stations.map((s: any) => s.id).sort()).toEqual(["s1", "s2", "s3"]); // deduped
    const s1 = stations.find((s: any) => s.id === "s1");
    expect(s1.connectors[0]).toEqual({ type: "CCS2", powerKW: 100 });
  });
});

describe("saveTrip", () => {
  const instance = () => ({
    save: jest.fn().mockResolvedValue(undefined),
    toObject: jest.fn().mockReturnValue({ _id: "trip-new" }),
  });

  it("201 saving a feasible plan", async () => {
    const inst = instance();
    TripMock.mockImplementation(() => inst);
    const res = buildRes();
    const next = jest.fn();
    await saveTrip({ user: { id: "u1" }, body: planBody({ name: "Road trip" }) } as any, res as any, next);
    expect(inst.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    // buildTripPayload maps _id -> id and drops _id/__v.
    expect(res.json.mock.calls[0][0].trip).toEqual({ id: "trip-new" });
  });

  it("422 refusing to save an infeasible plan", async () => {
    planTripMock.mockReturnValue({ ...feasiblePlan(), feasible: false, reason: "unreachable" });
    const next = jest.fn();
    await saveTrip({ user: { id: "u1" }, body: planBody() } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
    expect(next.mock.calls[0][0].message).toBe("unreachable");
  });

  it("persists stop snapshots, keeping a station ref only for valid ObjectIds", async () => {
    const inst = instance();
    TripMock.mockImplementation(() => inst);
    planTripMock.mockReturnValue({
      ...feasiblePlan(),
      totalStops: 2,
      stops: [
        { station: { id: "507f1f77bcf86cd799439055", name: "A", address: "a", lat: 0, lng: 2 }, connectorType: "CCS2", powerKW: 100, distanceFromPrevKm: 100, cumulativeKm: 100, detourKm: 1, arrivalBatteryPercent: 30, departBatteryPercent: 80 },
        { station: { id: "not-an-objectid", name: "B", lat: 0, lng: 4 }, connectorType: "Type2", powerKW: 22, distanceFromPrevKm: 50, cumulativeKm: 150, detourKm: 2, arrivalBatteryPercent: 40, departBatteryPercent: 80 },
      ],
    });
    const next = jest.fn();
    await saveTrip({ user: { id: "u1" }, body: planBody() } as any, buildRes() as any, next);

    const doc = TripMock.mock.calls[0][0];
    expect(doc.stops).toHaveLength(2);
    expect(String(doc.stops[0].station)).toBe("507f1f77bcf86cd799439055");
    expect(doc.stops[1].station).toBeUndefined(); // invalid ObjectId → ref dropped
    expect(doc.stops[1].name).toBe("B"); // denormalized snapshot retained
  });
});

describe("getMyTrips", () => {
  it("401 when unauthenticated", async () => {
    const next = jest.fn();
    await getMyTrips({ session: {} } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("returns the caller's trips", async () => {
    TripMock.find.mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve([{ _id: "t1" }, { _id: "t2" }]) }),
    });
    const res = buildRes();
    const next = jest.fn();
    await getMyTrips({ user: { id: "u1" } } as any, res as any, next);
    expect(TripMock.find).toHaveBeenCalledWith({ user: "u1" });
    expect(res.json.mock.calls[0][0].trips).toHaveLength(2);
    expect(res.json.mock.calls[0][0].trips[0].id).toBe("t1");
  });
});

describe("getTripById", () => {
  it("422 for an invalid id", async () => {
    const next = jest.fn();
    await getTripById({ user: { id: "u1" }, params: { tripId: "bad" } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("404 when not found", async () => {
    TripMock.findById.mockReturnValue(lean(null));
    const next = jest.fn();
    await getTripById({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when neither owner nor admin", async () => {
    TripMock.findById.mockReturnValue(lean({ _id: VALID_TRIP, user: "other" }));
    const next = jest.fn();
    await getTripById({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("returns the trip to its owner", async () => {
    TripMock.findById.mockReturnValue(lean({ _id: VALID_TRIP, user: "u1" }));
    const res = buildRes();
    const next = jest.fn();
    await getTripById({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].trip.id).toBe(VALID_TRIP);
  });

  it("returns any trip to an admin", async () => {
    TripMock.findById.mockReturnValue(lean({ _id: VALID_TRIP, user: "other" }));
    const res = buildRes();
    const next = jest.fn();
    await getTripById({ user: { id: "admin1", role: "admin" }, params: { tripId: VALID_TRIP } } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("deleteTrip", () => {
  const hydrated = (over: Record<string, unknown> = {}) => {
    const data: Record<string, unknown> = { user: "u1", ...over };
    return {
      get: (k: string) => data[k],
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
  };

  it("404 when not found", async () => {
    TripMock.findById.mockResolvedValue(null);
    const next = jest.fn();
    await deleteTrip({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when neither owner nor admin", async () => {
    TripMock.findById.mockResolvedValue(hydrated({ user: "other" }));
    const next = jest.fn();
    await deleteTrip({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("deletes the caller's own trip", async () => {
    const doc = hydrated();
    TripMock.findById.mockResolvedValue(doc);
    const res = buildRes();
    const next = jest.fn();
    await deleteTrip({ user: { id: "u1" }, params: { tripId: VALID_TRIP } } as any, res as any, next);
    expect(doc.deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("lets an admin delete any trip", async () => {
    const doc = hydrated({ user: "other" });
    TripMock.findById.mockResolvedValue(doc);
    const res = buildRes();
    const next = jest.fn();
    await deleteTrip({ user: { id: "admin1", role: "admin" }, params: { tripId: VALID_TRIP } } as any, res as any, next);
    expect(doc.deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
