export {};

import {
  recordChargingHistory,
  fetchChargingHistoryForUser,
} from "../charging-history-service";

// Mock the ChargingHistory model
jest.mock("../../models/charging-history", () => {
  const mockSave = jest.fn();
  const mockToObject = jest.fn();

  const MockChargingHistory = jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave,
    toObject: mockToObject,
  }));

  (MockChargingHistory as any).find = jest.fn();
  (MockChargingHistory as any).mockSave = mockSave;
  (MockChargingHistory as any).mockToObject = mockToObject;

  return {
    __esModule: true,
    default: MockChargingHistory,
  };
});

const ChargingHistory = require("../../models/charging-history").default;

describe("charging-history-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ChargingHistory.mockSave.mockResolvedValue(undefined);
    ChargingHistory.mockToObject.mockReturnValue({ id: "history-1" });
  });

  describe("recordChargingHistory", () => {
    const validParams = {
      userId: "user-123",
      ticketSnapshot: {
        id: "ticket-456",
        station: "station-789",
        vehicle: "vehicle-abc",
        connectorType: "CCS2",
        chargingSpeed: "FAST",
        ticketKwh: 30,
        startedAt: new Date("2024-01-01T10:00:00Z"),
        progressPercent: 100,
        startingBatteryPercent: 40,
        batteryPercentage: 90,
        chargingDurationMs: 300000,
        stationInfo: { id: "station-789", name: "Test Station", address: "123 Main St" },
        vehicleInfo: { id: "vehicle-abc", name: "My Car" },
      },
      outcome: "COMPLETED" as const,
      endedAt: new Date("2024-01-01T10:05:00Z"),
    };

    it("returns null if userId is empty", async () => {
      const result = await recordChargingHistory({
        ...validParams,
        userId: "",
      });
      expect(result).toBeNull();
    });

    it("returns null if ticketSnapshot is empty", async () => {
      const result = await recordChargingHistory({
        ...validParams,
        ticketSnapshot: null as any,
      });
      expect(result).toBeNull();
    });

    it("returns null if outcome is empty", async () => {
      const result = await recordChargingHistory({
        ...validParams,
        outcome: "" as any,
      });
      expect(result).toBeNull();
    });

    it("returns null if ticketSnapshot has no id", async () => {
      const result = await recordChargingHistory({
        ...validParams,
        ticketSnapshot: { station: "station-123" },
      });
      expect(result).toBeNull();
    });

    it("creates history entry with all fields", async () => {
      await recordChargingHistory(validParams);

      expect(ChargingHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          user: "user-123",
          ticketId: "ticket-456",
          station: "station-789",
          vehicle: "vehicle-abc",
          connectorType: "CCS2",
          chargingSpeed: "FAST",
          outcome: "COMPLETED",
        })
      );
    });

    it("saves the history entry", async () => {
      await recordChargingHistory(validParams);

      expect(ChargingHistory.mockSave).toHaveBeenCalled();
    });

    it("returns the saved entry as object", async () => {
      ChargingHistory.mockToObject.mockReturnValue({
        id: "history-123",
        ticketId: "ticket-456",
      });

      const result = await recordChargingHistory(validParams);

      expect(result).toEqual({ id: "history-123", ticketId: "ticket-456" });
    });

    it("handles duplicate key error (code 11000)", async () => {
      const duplicateError = new Error("Duplicate key") as any;
      duplicateError.code = 11000;
      ChargingHistory.mockSave.mockRejectedValue(duplicateError);

      const result = await recordChargingHistory(validParams);

      expect(result).toBeNull();
    });

    it("throws other errors", async () => {
      const dbError = new Error("Database connection failed");
      ChargingHistory.mockSave.mockRejectedValue(dbError);

      await expect(recordChargingHistory(validParams)).rejects.toThrow(
        "Database connection failed"
      );
    });

    it("handles CANCELLED outcome", async () => {
      await recordChargingHistory({
        ...validParams,
        outcome: "CANCELLED",
      });

      expect(ChargingHistory).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "CANCELLED" })
      );
    });

    it("uses current date if endedAt is invalid", async () => {
      const beforeCall = Date.now();

      await recordChargingHistory({
        ...validParams,
        endedAt: null as any,
      });

      const call = ChargingHistory.mock.calls[0][0];
      const endedAt = call.endedAt as Date;
      expect(endedAt.getTime()).toBeGreaterThanOrEqual(beforeCall);
    });

    it("resolves stationId from stationInfo if not on snapshot", async () => {
      await recordChargingHistory({
        ...validParams,
        ticketSnapshot: {
          id: "ticket-456",
          stationInfo: { id: "station-from-info" },
        },
      });

      expect(ChargingHistory).toHaveBeenCalledWith(
        expect.objectContaining({ station: "station-from-info" })
      );
    });

    it("resolves vehicleId from vehicleInfo if not on snapshot", async () => {
      await recordChargingHistory({
        ...validParams,
        ticketSnapshot: {
          id: "ticket-456",
          vehicleInfo: { id: "vehicle-from-info" },
        },
      });

      expect(ChargingHistory).toHaveBeenCalledWith(
        expect.objectContaining({ vehicle: "vehicle-from-info" })
      );
    });

    it("normalizes percent values", async () => {
      await recordChargingHistory({
        ...validParams,
        ticketSnapshot: {
          ...validParams.ticketSnapshot,
          progressPercent: 150,
          startingBatteryPercent: -10,
        },
      });

      const call = ChargingHistory.mock.calls[0][0];
      expect(call.progressPercent).toBe(100);
      expect(call.startingBatteryPercent).toBe(0);
    });

    it("handles invalid connectorType", async () => {
      await recordChargingHistory({
        ...validParams,
        ticketSnapshot: {
          ...validParams.ticketSnapshot,
          connectorType: "INVALID",
        },
      });

      const call = ChargingHistory.mock.calls[0][0];
      expect(call.connectorType).toBeNull();
    });

    it("handles invalid chargingSpeed", async () => {
      await recordChargingHistory({
        ...validParams,
        ticketSnapshot: {
          ...validParams.ticketSnapshot,
          chargingSpeed: "SLOW",
        },
      });

      const call = ChargingHistory.mock.calls[0][0];
      expect(call.chargingSpeed).toBeNull();
    });
  });

  describe("fetchChargingHistoryForUser", () => {
    it("returns empty array if userId is empty", async () => {
      const result = await fetchChargingHistoryForUser("", new Date());
      expect(result).toEqual([]);
    });

    it("queries with correct filters", async () => {
      const mockLean = jest.fn().mockResolvedValue([]);
      const mockSort = jest.fn().mockReturnValue({ lean: mockLean });
      ChargingHistory.find.mockReturnValue({ sort: mockSort });

      const since = new Date("2024-01-01");
      await fetchChargingHistoryForUser("user-123", since);

      expect(ChargingHistory.find).toHaveBeenCalledWith(
        { user: "user-123", endedAt: { $gte: since } },
        { __v: 0 }
      );
      expect(mockSort).toHaveBeenCalledWith({ endedAt: -1 });
    });

    it("returns history entries", async () => {
      const mockEntries = [
        { id: "entry-1", ticketId: "ticket-1" },
        { id: "entry-2", ticketId: "ticket-2" },
      ];
      const mockLean = jest.fn().mockResolvedValue(mockEntries);
      const mockSort = jest.fn().mockReturnValue({ lean: mockLean });
      ChargingHistory.find.mockReturnValue({ sort: mockSort });

      const result = await fetchChargingHistoryForUser("user-123", new Date());

      expect(result).toEqual(mockEntries);
    });
  });
});
