import {
  createReservation,
  getMyReservations,
  getReservationById,
  cancelReservation,
  getAvailability,
  getStationReservations,
} from "../reservation-controllers";
import Station from "../../models/station";
import Vehicle from "../../models/vehicle";
import Reservation from "../../models/reservation";
import { validationResult } from "express-validator";
import {
  validateReservationWindow,
  getConnectorPorts,
  countOverlappingReservations,
  userHasOverlappingReservation,
  buildReservationPayload,
} from "../../services/reservation-service";

jest.mock("express-validator", () => ({ validationResult: jest.fn() }));

jest.mock("../../models/station", () => {
  const M = jest.fn() as jest.Mock & { findById: jest.Mock };
  M.findById = jest.fn();
  return { __esModule: true, default: M };
});
jest.mock("../../models/vehicle", () => {
  const M = jest.fn() as jest.Mock & { findById: jest.Mock };
  M.findById = jest.fn();
  return { __esModule: true, default: M };
});
jest.mock("../../models/reservation", () => {
  const M = jest.fn() as jest.Mock & { find: jest.Mock; findById: jest.Mock };
  M.find = jest.fn();
  M.findById = jest.fn();
  return { __esModule: true, default: M };
});
jest.mock("../../services/reservation-service", () => ({
  validateReservationWindow: jest.fn(),
  getConnectorPorts: jest.fn(),
  countOverlappingReservations: jest.fn(),
  userHasOverlappingReservation: jest.fn(),
  buildReservationPayload: jest.fn((r: any) => ({
    id: r?._id ?? r?.id ?? null,
    shaped: true,
  })),
}));

const StationMock = Station as unknown as jest.Mock & { findById: jest.Mock };
const VehicleMock = Vehicle as unknown as jest.Mock & { findById: jest.Mock };
const ReservationMock = Reservation as unknown as jest.Mock & {
  find: jest.Mock;
  findById: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const validateWindowMock = validateReservationWindow as jest.Mock;
const getPortsMock = getConnectorPorts as jest.Mock;
const countOverlapMock = countOverlappingReservations as jest.Mock;
const userOverlapMock = userHasOverlappingReservation as jest.Mock;

type MockResponse = { status: jest.Mock; json: jest.Mock };
const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const VALID_STATION = "507f1f77bcf86cd799439011";
const VALID_VEHICLE = "507f1f77bcf86cd799439012";
const VALID_RES = "507f1f77bcf86cd799439013";

const lean = (resolved: unknown) => ({
  lean: jest.fn(() => Promise.resolve(resolved)),
});
const findListChain = (resolved: unknown) => {
  const q: any = {};
  q.sort = jest.fn(() => q);
  q.populate = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(resolved));
  return q;
};
const findByIdChain = (resolved: unknown) => {
  const q: any = {};
  q.populate = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(resolved));
  return q;
};
const reservationInstance = () => ({
  save: jest.fn().mockResolvedValue(undefined),
  populate: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn().mockReturnValue({ _id: "res-new" }),
});

beforeEach(() => {
  jest.clearAllMocks();
  validationResultMock.mockReturnValue({ isEmpty: () => true });
  validateWindowMock.mockReturnValue(null);
  getPortsMock.mockReturnValue(2);
  countOverlapMock.mockResolvedValue(0);
  userOverlapMock.mockResolvedValue(false);
  StationMock.findById.mockReturnValue(lean({ _id: VALID_STATION, connectors: [] }));
});

describe("createReservation", () => {
  const baseReq = () => ({
    user: { id: "u1" },
    body: {
      stationId: VALID_STATION,
      connectorType: "CCS2",
      startTime: "2026-07-01T10:00:00.000Z",
      endTime: "2026-07-01T11:00:00.000Z",
    },
  });

  it("422 when validation fails", async () => {
    validationResultMock.mockReturnValue({ isEmpty: () => false });
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("401 when unauthenticated", async () => {
    const next = jest.fn();
    await createReservation({ ...baseReq(), user: undefined, session: {} } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("422 for an invalid station id", async () => {
    const next = jest.fn();
    await createReservation({ ...baseReq(), body: { ...baseReq().body, stationId: "bad" } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("422 for an invalid connector type", async () => {
    const next = jest.fn();
    await createReservation({ ...baseReq(), body: { ...baseReq().body, connectorType: "NACS" } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("422 when the window is invalid", async () => {
    validateWindowMock.mockReturnValue("Reservation is too short (minimum 15 minutes).");
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
    expect(next.mock.calls[0][0].message).toMatch(/too short/);
  });

  it("404 when the station does not exist", async () => {
    StationMock.findById.mockReturnValue(lean(null));
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("422 when the station lacks the connector type", async () => {
    getPortsMock.mockReturnValue(null);
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("404 when a supplied vehicle does not exist", async () => {
    VehicleMock.findById.mockReturnValue(lean(null));
    const next = jest.fn();
    await createReservation(
      { ...baseReq(), body: { ...baseReq().body, vehicleId: VALID_VEHICLE } } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when the supplied vehicle is not owned by the caller", async () => {
    VehicleMock.findById.mockReturnValue(lean({ _id: VALID_VEHICLE, owner: "someone-else" }));
    const next = jest.fn();
    await createReservation(
      { ...baseReq(), body: { ...baseReq().body, vehicleId: VALID_VEHICLE } } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("409 when the user already has an overlapping reservation", async () => {
    userOverlapMock.mockResolvedValue(true);
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(409);
  });

  it("409 when no ports are available for the window", async () => {
    getPortsMock.mockReturnValue(2);
    countOverlapMock.mockResolvedValue(2);
    const next = jest.fn();
    await createReservation(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(409);
  });

  it("201 on success, saving and returning the reservation", async () => {
    const instance = reservationInstance();
    ReservationMock.mockImplementation(() => instance);
    const res = buildRes();
    const next = jest.fn();

    await createReservation(baseReq() as any, res as any, next);

    expect(instance.save).toHaveBeenCalled();
    expect(instance.populate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].reservation).toEqual({ id: "res-new", shaped: true });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("getMyReservations", () => {
  it("401 when unauthenticated", async () => {
    const next = jest.fn();
    await getMyReservations({ query: {}, session: {} } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("returns the caller's reservations", async () => {
    ReservationMock.find.mockReturnValue(findListChain([{ _id: "r1" }, { _id: "r2" }]));
    const res = buildRes();
    const next = jest.fn();
    await getMyReservations({ user: { id: "u1" }, query: {} } as any, res as any, next);
    expect(ReservationMock.find).toHaveBeenCalledWith({ user: "u1" });
    expect(res.json.mock.calls[0][0].reservations).toHaveLength(2);
  });

  it("filters to upcoming ACTIVE reservations", async () => {
    ReservationMock.find.mockReturnValue(findListChain([]));
    const next = jest.fn();
    await getMyReservations({ user: { id: "u1" }, query: { upcoming: "true" } } as any, buildRes() as any, next);
    const filter = ReservationMock.find.mock.calls[0][0];
    expect(filter.status).toBe("ACTIVE");
    expect(filter.endTime.$gte).toBeInstanceOf(Date);
  });
});

describe("getReservationById", () => {
  it("422 for an invalid id", async () => {
    const next = jest.fn();
    await getReservationById({ user: { id: "u1" }, params: { reservationId: "bad" } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("404 when not found", async () => {
    ReservationMock.findById.mockReturnValue(findByIdChain(null));
    const next = jest.fn();
    await getReservationById({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when the caller is neither owner nor admin", async () => {
    ReservationMock.findById.mockReturnValue(findByIdChain({ _id: VALID_RES, user: "other" }));
    const next = jest.fn();
    await getReservationById({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("returns the reservation to its owner", async () => {
    ReservationMock.findById.mockReturnValue(findByIdChain({ _id: VALID_RES, user: "u1" }));
    const res = buildRes();
    const next = jest.fn();
    await getReservationById({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns any reservation to an admin", async () => {
    ReservationMock.findById.mockReturnValue(findByIdChain({ _id: VALID_RES, user: "other" }));
    const res = buildRes();
    const next = jest.fn();
    await getReservationById({ user: { id: "admin1", role: "admin" }, params: { reservationId: VALID_RES } } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("cancelReservation", () => {
  const hydrated = (over: Record<string, unknown> = {}) => {
    const data: Record<string, unknown> = { user: "u1", status: "ACTIVE", ...over };
    return {
      get: (k: string) => data[k],
      set: (k: string, v: unknown) => {
        data[k] = v;
      },
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({ _id: VALID_RES, ...data }),
      _data: data,
    };
  };

  it("404 when not found", async () => {
    ReservationMock.findById.mockResolvedValue(null);
    const next = jest.fn();
    await cancelReservation({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("403 when the caller is not owner/admin", async () => {
    ReservationMock.findById.mockResolvedValue(hydrated({ user: "other" }));
    const next = jest.fn();
    await cancelReservation({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(403);
  });

  it("cancels an active reservation owned by the caller", async () => {
    const doc = hydrated();
    ReservationMock.findById.mockResolvedValue(doc);
    const res = buildRes();
    const next = jest.fn();
    await cancelReservation({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, res as any, next);
    expect(doc._data.status).toBe("CANCELLED");
    expect(doc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("is idempotent for an already-cancelled reservation (no save)", async () => {
    const doc = hydrated({ status: "CANCELLED" });
    ReservationMock.findById.mockResolvedValue(doc);
    const res = buildRes();
    const next = jest.fn();
    await cancelReservation({ user: { id: "u1" }, params: { reservationId: VALID_RES } } as any, res as any, next);
    expect(doc.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("lets an admin cancel another user's reservation", async () => {
    const doc = hydrated({ user: "other" });
    ReservationMock.findById.mockResolvedValue(doc);
    const res = buildRes();
    const next = jest.fn();
    await cancelReservation({ user: { id: "admin1", role: "admin" }, params: { reservationId: VALID_RES } } as any, res as any, next);
    expect(doc._data.status).toBe("CANCELLED");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("getAvailability", () => {
  const baseReq = () => ({
    query: {
      stationId: VALID_STATION,
      connectorType: "CCS2",
      startTime: "2026-07-01T10:00:00.000Z",
      endTime: "2026-07-01T11:00:00.000Z",
    },
  });

  it("422 when validation fails", async () => {
    validationResultMock.mockReturnValue({ isEmpty: () => false });
    const next = jest.fn();
    await getAvailability(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("422 for an invalid time window", async () => {
    const next = jest.fn();
    await getAvailability(
      { query: { ...baseReq().query, endTime: "2026-07-01T09:00:00.000Z" } } as any,
      buildRes() as any,
      next
    );
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("404 when the station does not exist", async () => {
    StationMock.findById.mockReturnValue(lean(null));
    const next = jest.fn();
    await getAvailability(baseReq() as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("reports ports, reserved and available", async () => {
    getPortsMock.mockReturnValue(3);
    countOverlapMock.mockResolvedValue(1);
    const res = buildRes();
    const next = jest.fn();
    await getAvailability(baseReq() as any, res as any, next);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      ports: 3,
      reserved: 1,
      available: 2,
      connectorType: "CCS2",
    });
  });
});

describe("getStationReservations", () => {
  it("422 for an invalid station id", async () => {
    const next = jest.fn();
    await getStationReservations({ params: { stationId: "bad" }, query: {} } as any, buildRes() as any, next);
    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("lists reservations for a station with the holder's name", async () => {
    ReservationMock.find.mockReturnValue(
      findListChain([{ _id: "r1", user: { _id: "u1", name: "Alice" } }])
    );
    const res = buildRes();
    const next = jest.fn();
    await getStationReservations({ params: { stationId: VALID_STATION }, query: {} } as any, res as any, next);
    expect(ReservationMock.find).toHaveBeenCalledWith({ station: VALID_STATION });
    expect(res.json.mock.calls[0][0].reservations[0].user).toEqual({
      id: "u1",
      name: "Alice",
    });
  });
});
