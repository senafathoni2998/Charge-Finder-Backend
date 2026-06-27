import { addStation, updateStation, deleteStation } from "../station-admin";
import Station from "../../../models/station";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("../../../models/station", () => {
  const StationMock = jest.fn() as jest.Mock & { findById: jest.Mock };
  StationMock.findById = jest.fn();
  return {
    __esModule: true,
    default: StationMock,
    toGeoPoint: (lat: unknown, lng: unknown) =>
      typeof lat === "number" && typeof lng === "number"
        ? { type: "Point", coordinates: [lng, lat] }
        : undefined,
  };
});

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const buildReq = (body: Record<string, unknown>) => ({ body });

const buildStationDoc = () => ({
  save: jest.fn(),
  deleteOne: jest.fn(),
  toObject: jest.fn(),
  set: jest.fn(),
  name: "Old Name",
  lat: 0,
  lng: 0,
  address: "Old Address",
  status: "AVAILABLE",
  lastUpdatedISO: "2020-01-01T00:00:00Z",
  pricing: { currency: "USD", perKwh: 0.2 },
  amenities: [],
  notes: "",
});

const StationMock = Station as unknown as jest.Mock & { findById: jest.Mock };
const validationResultMock = validationResult as unknown as jest.Mock;

describe("station-admin controllers", () => {
  beforeEach(() => {
    StationMock.mockReset();
    StationMock.findById.mockReset();
    validationResultMock.mockReset();
    validationResultMock.mockReturnValue({ isEmpty: () => true });
  });

  describe("addStation", () => {
    it("returns 422 when validation fails", async () => {
      validationResultMock.mockReturnValue({ isEmpty: () => false });
      const req = buildReq({});
      const res = buildRes();
      const next = jest.fn();

      await addStation(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(HttpError));
      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(422);
      expect(StationMock).not.toHaveBeenCalled();
    });

    it("persists a new station and returns the created payload", async () => {
      const stationDoc = buildStationDoc();
      stationDoc.toObject.mockReturnValue({ id: "station-1" });
      StationMock.mockImplementation(() => stationDoc);

      const req = buildReq({
        name: "Station One",
        lat: 1,
        lng: 2,
        address: "123 Main St",
        connectors: [
          { type: "CCS2", powerKW: 50, ports: 2, availablePorts: 2 },
        ],
        status: "AVAILABLE",
        lastUpdatedISO: "2024-01-01T00:00:00Z",
        pricing: { currency: "USD", perKwh: 0.35 },
        notes: "New install",
      });
      const res = buildRes();
      const next = jest.fn();

      await addStation(req as any, res as any, next);

      expect(StationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Station One",
          photos: [],
          amenities: [],
        })
      );
      expect(stationDoc.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: "New station added successfully!",
        station: { id: "station-1" },
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("updateStation", () => {
    it("updates provided fields and persists the station", async () => {
      const stationDoc = buildStationDoc();
      stationDoc.toObject.mockReturnValue({ id: "station-2" });
      StationMock.findById.mockResolvedValue(stationDoc);

      const req = buildReq({
        stationId: "station-2",
        name: "Updated Name",
        lat: 10,
        lng: 20,
        address: "456 Main St",
        connectors: [
          { type: "Type2", powerKW: 22, ports: 1, availablePorts: 1 },
        ],
        status: "BUSY",
        lastUpdatedISO: "2024-02-01T00:00:00Z",
        photos: [{ label: "Front", gradient: "linear-gradient(#fff,#000)" }],
        pricing: { currency: "USD", perKwh: 0.4 },
        amenities: ["Cafe"],
        notes: "Maintenance scheduled",
      });
      const res = buildRes();
      const next = jest.fn();

      await updateStation(req as any, res as any, next);

      expect(StationMock.findById).toHaveBeenCalledWith("station-2");
      expect(stationDoc.name).toBe("Updated Name");
      expect(stationDoc.lat).toBe(10);
      expect(stationDoc.lng).toBe(20);
      expect(stationDoc.address).toBe("456 Main St");
      expect(stationDoc.status).toBe("BUSY");
      expect(stationDoc.lastUpdatedISO).toBe("2024-02-01T00:00:00Z");
      expect(stationDoc.pricing).toEqual({ currency: "USD", perKwh: 0.4 });
      expect(stationDoc.amenities).toEqual(["Cafe"]);
      expect(stationDoc.notes).toBe("Maintenance scheduled");
      expect(stationDoc.set).toHaveBeenCalledWith("connectors", [
        { type: "Type2", powerKW: 22, ports: 1, availablePorts: 1 },
      ]);
      expect(stationDoc.set).toHaveBeenCalledWith("photos", [
        { label: "Front", gradient: "linear-gradient(#fff,#000)" },
      ]);
      expect(stationDoc.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Station updated successfully!",
        station: { id: "station-2" },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 404 when the station cannot be found", async () => {
      StationMock.findById.mockResolvedValue(null);
      const req = buildReq({ stationId: "missing-station" });
      const res = buildRes();
      const next = jest.fn();

      await updateStation(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(HttpError));
      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(404);
    });
  });

  describe("deleteStation", () => {
    it("deletes the station and returns confirmation", async () => {
      const stationDoc = buildStationDoc();
      StationMock.findById.mockResolvedValue(stationDoc);
      stationDoc.deleteOne.mockResolvedValue(undefined);

      const req = buildReq({ stationId: "station-3" });
      const res = buildRes();
      const next = jest.fn();

      await deleteStation(req as any, res as any, next);

      expect(stationDoc.deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Station deleted successfully!",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 404 when the station cannot be found", async () => {
      StationMock.findById.mockResolvedValue(null);
      const req = buildReq({ stationId: "missing-station" });
      const res = buildRes();
      const next = jest.fn();

      await deleteStation(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(HttpError));
      const error = next.mock.calls[0][0] as HttpError;
      expect(error.code).toBe(404);
    });
  });
});
