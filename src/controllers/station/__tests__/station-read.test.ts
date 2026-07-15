import {
  getStations,
  getStationById,
  getStationAvailability,
} from "../station-read";
import Station from "../../../models/station";
import ChargingTicket from "../../../models/charging-ticket";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("mongoose", () => ({
  __esModule: true,
  default: {
    Types: {
      ObjectId: {
        isValid: jest.fn(),
      },
    },
  },
}));

jest.mock("../../../models/station", () => {
  const StationMock = jest.fn() as jest.Mock & {
    find: jest.Mock;
    findById: jest.Mock;
    aggregate: jest.Mock;
  };
  StationMock.find = jest.fn();
  StationMock.findById = jest.fn();
  StationMock.aggregate = jest.fn();
  return { __esModule: true, default: StationMock };
});

jest.mock("../../../models/charging-ticket", () => {
  const ChargingTicketMock = jest.fn() as jest.Mock & {
    find: jest.Mock;
    findOne: jest.Mock;
  };
  ChargingTicketMock.find = jest.fn();
  ChargingTicketMock.findOne = jest.fn();
  return { __esModule: true, default: ChargingTicketMock };
});

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  set: jest.Mock;
  vary: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  set: jest.fn().mockReturnThis(),
  vary: jest.fn().mockReturnThis(),
});

// Pulls the last Cache-Control value passed to res.set(...) across its call forms:
// res.set("Cache-Control", value) or res.set({ "Cache-Control": value }).
const cacheControlOf = (res: MockResponse): string | undefined => {
  for (let i = res.set.mock.calls.length - 1; i >= 0; i -= 1) {
    const [a, b] = res.set.mock.calls[i];
    if (a === "Cache-Control" && typeof b === "string") return b;
    if (a && typeof a === "object" && typeof a["Cache-Control"] === "string") {
      return a["Cache-Control"];
    }
  }
  return undefined;
};

const StationMock = Station as unknown as jest.Mock & {
  find: jest.Mock;
  findById: jest.Mock;
  aggregate: jest.Mock;
};
const ChargingTicketMock = ChargingTicket as unknown as jest.Mock & {
  find: jest.Mock;
  findOne: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const isValidMock = (mongoose as unknown as {
  Types: { ObjectId: { isValid: jest.Mock } };
}).Types.ObjectId.isValid;

describe("station-read controllers", () => {
  beforeEach(() => {
    StationMock.find.mockReset();
    StationMock.findById.mockReset();
    StationMock.aggregate.mockReset();
    ChargingTicketMock.find.mockReset();
    ChargingTicketMock.findOne.mockReset();
    validationResultMock.mockReset();
    isValidMock.mockReset();

    validationResultMock.mockReturnValue({ isEmpty: () => true });
    isValidMock.mockReturnValue(true);
  });

  it("rejects missing lng when lat is provided", async () => {
    const req = { query: { lat: "10" } };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    const error = next.mock.calls[0][0] as HttpError;
    expect(error.code).toBe(422);
    expect(StationMock.find).not.toHaveBeenCalled();
  });

  it("returns stations without charging flags for anonymous users", async () => {
    const stations = [
      {
        toObject: jest.fn().mockReturnValue({
          id: "station-1",
          lat: 1,
          lng: 2,
        }),
      },
      {
        toObject: jest.fn().mockReturnValue({
          id: "station-2",
          lat: 3,
          lng: 4,
        }),
      },
    ];
    StationMock.find.mockResolvedValue(stations);

    const req = { query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    const payload = res.json.mock.calls[0][0] as {
      stations: Array<{ isChargingHere: boolean }>;
    };
    expect(payload.stations).toHaveLength(2);
    expect(payload.stations[0].isChargingHere).toBe(false);
    expect(payload.stations[1].isChargingHere).toBe(false);
    expect(ChargingTicketMock.find).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    // Anonymous list is publicly cacheable, and varies on the auth cookie so a
    // signed-in user is never served this anonymous response from a shared cache.
    expect(cacheControlOf(res)).toBe(
      "public, max-age=30, stale-while-revalidate=300"
    );
    expect(res.vary).toHaveBeenCalledWith("Cookie");
  });

  it("flags stations where the user is actively charging", async () => {
    const stations = [
      {
        toObject: jest.fn().mockReturnValue({
          id: "station-1",
          lat: 1,
          lng: 2,
        }),
      },
      {
        toObject: jest.fn().mockReturnValue({
          id: "station-2",
          lat: 3,
          lng: 4,
        }),
      },
    ];
    StationMock.find.mockResolvedValue(stations);
    ChargingTicketMock.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ station: "station-1" }]),
    });

    const req = { query: {}, user: { id: "user-1" } };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    const payload = res.json.mock.calls[0][0] as {
      stations: Array<{ id: string; isChargingHere: boolean }>;
    };
    const stationOne = payload.stations.find(
      (station) => station.id === "station-1"
    );
    const stationTwo = payload.stations.find(
      (station) => station.id === "station-2"
    );

    expect(stationOne?.isChargingHere).toBe(true);
    expect(stationTwo?.isChargingHere).toBe(false);
    expect(next).not.toHaveBeenCalled();
    // A personalized response (per-user isChargingHere) must be private so no
    // shared cache leaks one user's charging flags to another.
    expect(cacheControlOf(res)).toBe(
      "private, max-age=15, stale-while-revalidate=60"
    );
    expect(res.vary).toHaveBeenCalledWith("Cookie");
  });

  it("uses a $geoNear aggregation (not a full scan) when location is provided", async () => {
    StationMock.aggregate.mockResolvedValue([
      {
        _id: "station-1",
        name: "Nearby",
        lat: 1.01,
        lng: 2.01,
        distanceMeters: 1500,
      },
    ]);

    const req = { query: { lat: "1", lng: "2", radiusKm: "5" } };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    // Proximity path must hit the geo index via aggregate, never Station.find().
    expect(StationMock.aggregate).toHaveBeenCalledTimes(1);
    expect(StationMock.find).not.toHaveBeenCalled();

    const pipeline = StationMock.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toHaveProperty("$geoNear");
    expect(pipeline[0].$geoNear.near).toEqual({
      type: "Point",
      coordinates: [2, 1],
    });
    expect(pipeline[0].$geoNear.maxDistance).toBe(5000);

    const payload = res.json.mock.calls[0][0] as {
      stations: Array<{ id: string; distanceKm: number; isChargingHere: boolean }>;
    };
    expect(payload.stations).toHaveLength(1);
    expect(payload.stations[0].id).toBe("station-1");
    expect(payload.stations[0].distanceKm).toBe(1.5);
    expect(payload.stations[0].isChargingHere).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects invalid station ids", async () => {
    isValidMock.mockReturnValue(false);
    const req = { params: { stationId: "not-valid" } };
    const res = buildRes();
    const next = jest.fn();

    await getStationById(req as any, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    const error = next.mock.calls[0][0] as HttpError;
    expect(error.code).toBe(422);
  });

  it("returns station details with charging status", async () => {
    const stationDoc = {
      toObject: jest.fn().mockReturnValue({ id: "station-1" }),
    };
    StationMock.findById.mockResolvedValue(stationDoc);
    ChargingTicketMock.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "ticket-1" }),
    });

    const req = { params: { stationId: "station-1" }, user: { id: "user-1" } };
    const res = buildRes();
    const next = jest.fn();

    await getStationById(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      station: { id: "station-1", isChargingHere: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(cacheControlOf(res)).toBe(
      "private, max-age=15, stale-while-revalidate=60"
    );
  });

  describe("getStationAvailability", () => {
    it("rejects an invalid station id with 422 without a DB read", async () => {
      isValidMock.mockReturnValue(false);
      const req = { params: { stationId: "nope" } };
      const res = buildRes();
      const next = jest.fn();

      await getStationAvailability(req as any, res as any, next);

      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(422);
      expect(StationMock.findById).not.toHaveBeenCalled();
    });

    it("returns 404 when the station is missing", async () => {
      StationMock.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      const req = { params: { stationId: "507f1f77bcf86cd799439011" } };
      const res = buildRes();
      const next = jest.fn();

      await getStationAvailability(req as any, res as any, next);

      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(404);
    });

    it("returns projected connector availability from an uncached lean read", async () => {
      StationMock.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "507f1f77bcf86cd799439011",
          status: "BUSY",
          lastUpdatedISO: "2026-01-01T00:00:00.000Z",
          connectors: [
            { type: "CCS2", powerKW: 100, ports: 4, availablePorts: 2, _id: "a" },
            { type: "Type2", powerKW: 22, ports: 2, availablePorts: 0, _id: "b" },
          ],
        }),
      });
      const req = { params: { stationId: "507f1f77bcf86cd799439011" } };
      const res = buildRes();
      const next = jest.fn();

      await getStationAvailability(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].availability).toEqual({
        stationId: "507f1f77bcf86cd799439011",
        status: "BUSY",
        lastUpdatedISO: "2026-01-01T00:00:00.000Z",
        connectors: [
          { type: "CCS2", powerKW: 100, ports: 4, availablePorts: 2 },
          { type: "Type2", powerKW: 22, ports: 2, availablePorts: 0 },
        ],
      });
      // Availability-only projection — no full document, no cache.
      expect(StationMock.findById).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        { status: 1, lastUpdatedISO: 1, connectors: 1 }
      );
      // Live availability must be uncacheable so a poll never returns stale ports.
      expect(cacheControlOf(res)).toBe("no-store");
    });

    it("maps a DB failure to 500", async () => {
      StationMock.findById.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("db down")),
      });
      const req = { params: { stationId: "507f1f77bcf86cd799439011" } };
      const res = buildRes();
      const next = jest.fn();

      await getStationAvailability(req as any, res as any, next);

      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(500);
    });

    it("clamps availablePorts into [0, ports] so the API never over-reports", async () => {
      StationMock.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "507f1f77bcf86cd799439011",
          status: "AVAILABLE",
          lastUpdatedISO: "2026-01-01T00:00:00.000Z",
          connectors: [
            { type: "CCS2", powerKW: 100, ports: 1, availablePorts: 3 },
            { type: "Type2", powerKW: 22, ports: 2, availablePorts: -1 },
          ],
        }),
      });
      const res = buildRes();
      const next = jest.fn();

      await getStationAvailability(
        { params: { stationId: "507f1f77bcf86cd799439011" } } as any,
        res as any,
        next
      );

      expect(res.json.mock.calls[0][0].availability.connectors).toEqual([
        { type: "CCS2", powerKW: 100, ports: 1, availablePorts: 1 },
        { type: "Type2", powerKW: 22, ports: 2, availablePorts: 0 },
      ]);
    });
  });
});
