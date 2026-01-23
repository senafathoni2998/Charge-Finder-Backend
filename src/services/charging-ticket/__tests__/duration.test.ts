export {};

import {
  resolveChargingDurationMsForTicket,
  resolveChargingDurationMsFromSnapshot,
} from "../duration";
import { CHARGING_DURATION_MS } from "../constants";

// Mock the Vehicle model
jest.mock("../../../models/vehicle", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}));

const Vehicle = require("../../../models/vehicle").default;

describe("charging-ticket/duration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveChargingDurationMsFromSnapshot", () => {
    it("returns chargingDurationMs from snapshot if present", () => {
      const snapshot = { chargingDurationMs: 120000 };
      expect(resolveChargingDurationMsFromSnapshot(snapshot)).toBe(120000);
    });

    it("returns 0 for negative chargingDurationMs", () => {
      const snapshot = { chargingDurationMs: -5000 };
      expect(resolveChargingDurationMsFromSnapshot(snapshot)).toBe(0);
    });

    it("calculates duration from battery info", () => {
      const snapshot = {
        startingBatteryPercent: 50,
        chargingSpeed: "NORMAL",
      };
      // 50% remaining = 50% of 7 min
      const result = resolveChargingDurationMsFromSnapshot(snapshot);
      expect(result).toBe((7 * 60 * 1000) / 2);
    });

    it("uses vehicleInfo for battery percent", () => {
      const snapshot = {};
      const vehicleInfo = { batteryPercent: 50 };
      const result = resolveChargingDurationMsFromSnapshot(snapshot, vehicleInfo);
      expect(result).toBe((7 * 60 * 1000) / 2);
    });

    it("uses FAST speed if specified", () => {
      const snapshot = {
        startingBatteryPercent: 50,
        chargingSpeed: "FAST",
      };
      const result = resolveChargingDurationMsFromSnapshot(snapshot);
      expect(result).toBe((5 * 60 * 1000) / 2);
    });

    it("uses ULTRA_FAST speed if specified", () => {
      const snapshot = {
        startingBatteryPercent: 50,
        chargingSpeed: "ULTRA_FAST",
      };
      const result = resolveChargingDurationMsFromSnapshot(snapshot);
      expect(result).toBe((3 * 60 * 1000) / 2);
    });

    it("returns max duration if no battery info available", () => {
      const snapshot = {};
      const result = resolveChargingDurationMsFromSnapshot(snapshot);
      expect(result).toBe(7 * 60 * 1000);
    });

    it("calculates with target battery percent", () => {
      const snapshot = {
        startingBatteryPercent: 40,
        targetBatteryPercent: 80,
        chargingSpeed: "NORMAL",
      };
      // 40% range to target = 40% of max
      const result = resolveChargingDurationMsFromSnapshot(snapshot);
      expect(result).toBe(Math.round((40 / 100) * 7 * 60 * 1000));
    });
  });

  describe("resolveChargingDurationMsForTicket", () => {
    it("returns CHARGING_DURATION_MS for null ticket", async () => {
      const result = await resolveChargingDurationMsForTicket(null);
      expect(result).toBe(CHARGING_DURATION_MS);
    });

    it("returns CHARGING_DURATION_MS for undefined ticket", async () => {
      const result = await resolveChargingDurationMsForTicket(undefined);
      expect(result).toBe(CHARGING_DURATION_MS);
    });

    it("returns chargingDurationMs from ticket if present", async () => {
      const ticket = { chargingDurationMs: 180000 };
      const result = await resolveChargingDurationMsForTicket(ticket);
      expect(result).toBe(180000);
    });

    it("returns 0 for negative chargingDurationMs on ticket", async () => {
      const ticket = { chargingDurationMs: -5000 };
      const result = await resolveChargingDurationMsForTicket(ticket);
      expect(result).toBe(0);
    });

    it("calculates from startingBatteryPercent on ticket", async () => {
      const ticket = {
        startingBatteryPercent: 50,
        chargingSpeed: "NORMAL",
      };
      const result = await resolveChargingDurationMsForTicket(ticket);
      expect(result).toBe((7 * 60 * 1000) / 2);
    });

    it("respects targetBatteryPercent on ticket", async () => {
      const ticket = {
        startingBatteryPercent: 40,
        targetBatteryPercent: 80,
        chargingSpeed: "NORMAL",
      };
      const result = await resolveChargingDurationMsForTicket(ticket);
      expect(result).toBe(Math.round((40 / 100) * 7 * 60 * 1000));
    });

    it("returns default if no vehicleId", async () => {
      const ticket = { chargingSpeed: "NORMAL" };
      const result = await resolveChargingDurationMsForTicket(ticket);
      expect(result).toBe(CHARGING_DURATION_MS);
    });

    it("fetches vehicle for battery info when vehicleId present", async () => {
      const mockVehicle = {
        batteryPercent: 60,
        batteryCapacity: 75,
      };
      Vehicle.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockVehicle),
      });

      const ticket = { vehicle: "vehicle-123", chargingSpeed: "NORMAL" };
      const result = await resolveChargingDurationMsForTicket(ticket);

      expect(Vehicle.findById).toHaveBeenCalledWith("vehicle-123", {
        batteryPercent: 1,
        batteryCapacity: 1,
      });
      // 40% remaining = 40% of max duration
      expect(result).toBe(Math.round((40 / 100) * 7 * 60 * 1000));
    });

    it("returns max duration if vehicle not found", async () => {
      Vehicle.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const ticket = { vehicle: "nonexistent", chargingSpeed: "FAST" };
      const result = await resolveChargingDurationMsForTicket(ticket);

      expect(result).toBe(5 * 60 * 1000);
    });

    it("returns max duration if vehicle has no batteryPercent", async () => {
      Vehicle.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ batteryCapacity: 75 }),
      });

      const ticket = { vehicle: "vehicle-123", chargingSpeed: "NORMAL" };
      const result = await resolveChargingDurationMsForTicket(ticket);

      expect(result).toBe(7 * 60 * 1000);
    });

    it("handles vehicle fetch error gracefully", async () => {
      Vehicle.findById.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("DB error")),
      });

      const ticket = { vehicle: "vehicle-123", chargingSpeed: "ULTRA_FAST" };
      const result = await resolveChargingDurationMsForTicket(ticket);

      expect(result).toBe(3 * 60 * 1000);
    });

    it("handles ObjectId-like vehicle references", async () => {
      const mockVehicle = { batteryPercent: 50 };
      Vehicle.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockVehicle),
      });

      const ticket = {
        vehicle: { _id: { toString: () => "objectid-123" } },
        chargingSpeed: "NORMAL",
      };
      const result = await resolveChargingDurationMsForTicket(ticket);

      expect(Vehicle.findById).toHaveBeenCalledWith("objectid-123", expect.any(Object));
    });
  });
});
