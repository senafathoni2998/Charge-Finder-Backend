import { getStations, getStationById } from "../station-read";
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
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

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
  });
});
