export {};

import {
  parseBatteryCapacityDefault,
  calculateBatteryStatus,
  ensureVehicleBatteryDefaults,
  backfillVehicleBatteryCapacity,
  refreshVehicleBatterySnapshot,
  refreshVehicleBatterySnapshots,
} from "../vehicle-battery-service";

// Mock Vehicle model
jest.mock("../../models/vehicle", () => ({
  __esModule: true,
  default: {
    updateMany: jest.fn(),
    find: jest.fn(),
    bulkWrite: jest.fn(),
  },
}));

const Vehicle = require("../../models/vehicle").default;

describe("vehicle-battery-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Vehicle.updateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    Vehicle.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    Vehicle.bulkWrite.mockResolvedValue({});
  });

  describe("parseBatteryCapacityDefault", () => {
    it("returns undefined for undefined input", () => {
      expect(parseBatteryCapacityDefault(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(parseBatteryCapacityDefault("")).toBeUndefined();
      expect(parseBatteryCapacityDefault("  ")).toBeUndefined();
    });

    it("returns null for 'null' string (case insensitive)", () => {
      expect(parseBatteryCapacityDefault("null")).toBeNull();
      expect(parseBatteryCapacityDefault("NULL")).toBeNull();
      expect(parseBatteryCapacityDefault("Null")).toBeNull();
    });

    it("returns number for valid numeric string", () => {
      expect(parseBatteryCapacityDefault("75")).toBe(75);
      expect(parseBatteryCapacityDefault("100.5")).toBe(100.5);
      expect(parseBatteryCapacityDefault("0")).toBe(0);
    });

    it("returns undefined for negative numbers", () => {
      expect(parseBatteryCapacityDefault("-10")).toBeUndefined();
    });

    it("returns undefined for non-numeric strings", () => {
      expect(parseBatteryCapacityDefault("abc")).toBeUndefined();
      expect(parseBatteryCapacityDefault("NaN")).toBeUndefined();
    });

    it("handles whitespace around valid values", () => {
      expect(parseBatteryCapacityDefault("  75  ")).toBe(75);
      expect(parseBatteryCapacityDefault("  null  ")).toBeNull();
    });
  });

  describe("calculateBatteryStatus", () => {
    it("returns FULL for 80% and above", () => {
      expect(calculateBatteryStatus(80)).toBe("FULL");
      expect(calculateBatteryStatus(100)).toBe("FULL");
      expect(calculateBatteryStatus(99)).toBe("FULL");
    });

    it("returns HIGH for 60-79%", () => {
      expect(calculateBatteryStatus(60)).toBe("HIGH");
      expect(calculateBatteryStatus(79)).toBe("HIGH");
    });

    it("returns MEDIUM for 40-59%", () => {
      expect(calculateBatteryStatus(40)).toBe("MEDIUM");
      expect(calculateBatteryStatus(59)).toBe("MEDIUM");
    });

    it("returns LOW for 20-39%", () => {
      expect(calculateBatteryStatus(20)).toBe("LOW");
      expect(calculateBatteryStatus(39)).toBe("LOW");
    });

    it("returns CRITICAL for below 20%", () => {
      expect(calculateBatteryStatus(19)).toBe("CRITICAL");
      expect(calculateBatteryStatus(0)).toBe("CRITICAL");
      expect(calculateBatteryStatus(10)).toBe("CRITICAL");
    });
  });

  describe("backfillVehicleBatteryCapacity", () => {
    it("updates vehicles without batteryCapacity", async () => {
      await backfillVehicleBatteryCapacity(75);

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { batteryCapacity: { $exists: false } },
        { $set: { batteryCapacity: 75 } }
      );
    });

    it("handles null capacity", async () => {
      await backfillVehicleBatteryCapacity(null);

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { batteryCapacity: { $exists: false } },
        { $set: { batteryCapacity: null } }
      );
    });
  });

  describe("ensureVehicleBatteryDefaults", () => {
    it("sets default batteryPercent for vehicles without it", async () => {
      await ensureVehicleBatteryDefaults();

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { batteryPercent: { $exists: false } },
        { $set: { batteryPercent: 100 } }
      );
    });

    it("sets default lastBatteryUpdatedAt for vehicles without it", async () => {
      await ensureVehicleBatteryDefaults();

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { lastBatteryUpdatedAt: { $exists: false } },
        { $set: { lastBatteryUpdatedAt: expect.any(Date) } }
      );
    });

    it("finds and updates vehicles missing batteryStatus", async () => {
      const mockVehicles = [
        { _id: "v1", batteryPercent: 50 },
        { _id: "v2", batteryPercent: 90 },
      ];
      Vehicle.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(mockVehicles) });

      await ensureVehicleBatteryDefaults();

      expect(Vehicle.find).toHaveBeenCalledWith(
        { batteryStatus: { $exists: false } },
        { batteryPercent: 1 }
      );
      expect(Vehicle.bulkWrite).toHaveBeenCalled();
    });

    it("does not call bulkWrite if no vehicles missing batteryStatus", async () => {
      Vehicle.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      await ensureVehicleBatteryDefaults();

      expect(Vehicle.bulkWrite).not.toHaveBeenCalled();
    });

    it("calculates correct status for each vehicle", async () => {
      const mockVehicles = [
        { _id: "v1", batteryPercent: 85 },
        { _id: "v2", batteryPercent: 15 },
      ];
      Vehicle.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(mockVehicles) });

      await ensureVehicleBatteryDefaults();

      const bulkWriteCall = Vehicle.bulkWrite.mock.calls[0][0];
      expect(bulkWriteCall[0].updateOne.update.$set.batteryStatus).toBe("FULL");
      expect(bulkWriteCall[1].updateOne.update.$set.batteryStatus).toBe("CRITICAL");
    });
  });

  describe("refreshVehicleBatterySnapshot", () => {
    it("returns null for null input", async () => {
      const result = await refreshVehicleBatterySnapshot(null);
      expect(result).toBeNull();
    });

    it("returns updated snapshot with battery info", async () => {
      const snapshot = {
        id: "vehicle-1",
        batteryPercent: 80,
        active: false,
      };

      const result = await refreshVehicleBatterySnapshot(snapshot);

      expect(result).toBeDefined();
      expect((result as any).batteryPercent).toBeDefined();
      expect((result as any).batteryStatus).toBeDefined();
    });

    it("calculates battery status", async () => {
      const snapshot = {
        id: "vehicle-1",
        batteryPercent: 50,
        active: false,
      };

      const result = await refreshVehicleBatterySnapshot(snapshot);

      expect((result as any).batteryStatus).toBe("MEDIUM");
    });
  });

  describe("refreshVehicleBatterySnapshots", () => {
    it("returns empty array for empty input", async () => {
      const result = await refreshVehicleBatterySnapshots([]);
      expect(result).toEqual([]);
    });

    it("processes multiple snapshots", async () => {
      const snapshots = [
        { id: "v1", batteryPercent: 80, active: false },
        { id: "v2", batteryPercent: 30, active: false },
      ];

      const result = await refreshVehicleBatterySnapshots(snapshots);

      expect(result.length).toBe(2);
      expect(result[0].batteryStatus).toBe("FULL");
      expect(result[1].batteryStatus).toBe("LOW");
    });

    it("drains battery for active non-charging vehicles", async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const snapshot = {
        id: "v1",
        batteryPercent: 80,
        active: true,
        chargingStatus: "IDLE",
        lastBatteryUpdatedAt: tenMinutesAgo,
      };

      const result = await refreshVehicleBatterySnapshots([snapshot]);

      // Battery should drain by 5% after 10 minutes
      expect(result[0].batteryPercent).toBe(75);
    });

    it("does not drain battery for charging vehicles", async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const snapshot = {
        id: "v1",
        batteryPercent: 80,
        active: true,
        chargingStatus: "CHARGING",
        lastBatteryUpdatedAt: tenMinutesAgo,
      };

      const result = await refreshVehicleBatterySnapshots([snapshot]);

      expect(result[0].batteryPercent).toBe(80);
    });

    it("does not drain battery for inactive vehicles", async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const snapshot = {
        id: "v1",
        batteryPercent: 80,
        active: false,
        lastBatteryUpdatedAt: tenMinutesAgo,
      };

      const result = await refreshVehicleBatterySnapshots([snapshot]);

      expect(result[0].batteryPercent).toBe(80);
    });

    it("writes updates to database", async () => {
      const snapshot = {
        id: "v1",
        batteryPercent: 80,
        active: false,
      };

      await refreshVehicleBatterySnapshots([snapshot]);

      expect(Vehicle.bulkWrite).toHaveBeenCalled();
    });

    it("handles multiple drain steps", async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const snapshot = {
        id: "v1",
        batteryPercent: 80,
        active: true,
        chargingStatus: "IDLE",
        lastBatteryUpdatedAt: thirtyMinutesAgo,
      };

      const result = await refreshVehicleBatterySnapshots([snapshot]);

      // 30 minutes = 3 drain steps = 15% drain
      expect(result[0].batteryPercent).toBe(65);
    });

    it("clamps battery to 0 minimum", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const snapshot = {
        id: "v1",
        batteryPercent: 20,
        active: true,
        chargingStatus: "IDLE",
        lastBatteryUpdatedAt: twoHoursAgo,
      };

      const result = await refreshVehicleBatterySnapshots([snapshot]);

      expect(result[0].batteryPercent).toBe(0);
      expect(result[0].batteryStatus).toBe("CRITICAL");
    });
  });
});
