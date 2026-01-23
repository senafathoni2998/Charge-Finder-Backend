export {};

import {
  appendChargingBatteryPercentage,
  calculateChargingBatteryPercentage,
  clampBatteryPercent,
  resolveBatteryCapacityFromInfo,
  resolveStartingBatteryPercent,
  resolveTargetBatteryPercent,
} from "../battery";

describe("charging-ticket/battery", () => {
  describe("clampBatteryPercent", () => {
    it("returns 0 for NaN", () => {
      expect(clampBatteryPercent(NaN)).toBe(0);
    });

    it("returns 0 for Infinity", () => {
      expect(clampBatteryPercent(Infinity)).toBe(0);
    });

    it("returns 0 for negative Infinity", () => {
      expect(clampBatteryPercent(-Infinity)).toBe(0);
    });

    it("returns 0 for negative values", () => {
      expect(clampBatteryPercent(-10)).toBe(0);
    });

    it("returns 100 for values over 100", () => {
      expect(clampBatteryPercent(150)).toBe(100);
    });

    it("rounds to nearest integer", () => {
      expect(clampBatteryPercent(50.4)).toBe(50);
      expect(clampBatteryPercent(50.5)).toBe(51);
      expect(clampBatteryPercent(50.6)).toBe(51);
    });

    it("returns the value for valid percentages", () => {
      expect(clampBatteryPercent(0)).toBe(0);
      expect(clampBatteryPercent(50)).toBe(50);
      expect(clampBatteryPercent(100)).toBe(100);
    });
  });

  describe("resolveBatteryCapacityFromInfo", () => {
    it("returns null for null", () => {
      expect(resolveBatteryCapacityFromInfo(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(resolveBatteryCapacityFromInfo(undefined)).toBeNull();
    });

    it("returns null for non-object", () => {
      expect(resolveBatteryCapacityFromInfo("string")).toBeNull();
      expect(resolveBatteryCapacityFromInfo(123)).toBeNull();
    });

    it("returns null if batteryCapacity is missing", () => {
      expect(resolveBatteryCapacityFromInfo({})).toBeNull();
    });

    it("returns null for non-number batteryCapacity", () => {
      expect(resolveBatteryCapacityFromInfo({ batteryCapacity: "75" })).toBeNull();
    });

    it("returns null for zero batteryCapacity", () => {
      expect(resolveBatteryCapacityFromInfo({ batteryCapacity: 0 })).toBeNull();
    });

    it("returns null for negative batteryCapacity", () => {
      expect(resolveBatteryCapacityFromInfo({ batteryCapacity: -10 })).toBeNull();
    });

    it("returns capacity for valid value", () => {
      expect(resolveBatteryCapacityFromInfo({ batteryCapacity: 75 })).toBe(75);
      expect(resolveBatteryCapacityFromInfo({ batteryCapacity: 100.5 })).toBe(100.5);
    });
  });

  describe("resolveStartingBatteryPercent", () => {
    it("returns null for empty snapshot and no vehicleInfo", () => {
      expect(resolveStartingBatteryPercent({}, null)).toBeNull();
    });

    it("uses startingBatteryPercent from snapshot", () => {
      expect(resolveStartingBatteryPercent({ startingBatteryPercent: 40 }, null)).toBe(40);
    });

    it("clamps startingBatteryPercent to valid range", () => {
      expect(resolveStartingBatteryPercent({ startingBatteryPercent: -10 }, null)).toBe(0);
      expect(resolveStartingBatteryPercent({ startingBatteryPercent: 150 }, null)).toBe(100);
    });

    it("falls back to vehicleInfo.batteryPercent", () => {
      expect(
        resolveStartingBatteryPercent({}, { batteryPercent: 60 })
      ).toBe(60);
    });

    it("uses snapshot.vehicleInfo if vehicleInfo param not provided", () => {
      expect(
        resolveStartingBatteryPercent({ vehicleInfo: { batteryPercent: 55 } }, null)
      ).toBe(55);
    });

    it("prioritizes startingBatteryPercent over vehicleInfo", () => {
      expect(
        resolveStartingBatteryPercent(
          { startingBatteryPercent: 30 },
          { batteryPercent: 60 }
        )
      ).toBe(30);
    });
  });

  describe("resolveTargetBatteryPercent", () => {
    it("returns null if startingBatteryPercent is null", () => {
      expect(resolveTargetBatteryPercent({}, null, null)).toBeNull();
    });

    it("uses targetBatteryPercent from snapshot", () => {
      expect(
        resolveTargetBatteryPercent({ targetBatteryPercent: 80 }, 40, null)
      ).toBe(80);
    });

    it("clamps targetBatteryPercent to valid range", () => {
      expect(
        resolveTargetBatteryPercent({ targetBatteryPercent: 150 }, 40, null)
      ).toBe(100);
    });

    it("calculates target from ticketKwh and batteryCapacity", () => {
      const snapshot = {
        ticketKwh: 30,
        vehicleInfo: { batteryCapacity: 60 },
      };
      // 30 kWh / 60 kWh capacity = 50% increase from starting 20% = 70%
      expect(resolveTargetBatteryPercent(snapshot, 20, null)).toBe(70);
    });

    it("returns null if ticketKwh is missing", () => {
      expect(
        resolveTargetBatteryPercent(
          { vehicleInfo: { batteryCapacity: 60 } },
          40,
          null
        )
      ).toBeNull();
    });

    it("returns null if batteryCapacity is missing", () => {
      expect(resolveTargetBatteryPercent({ ticketKwh: 30 }, 40, null)).toBeNull();
    });
  });

  describe("calculateChargingBatteryPercentage", () => {
    it("returns starting percent at 0% progress", () => {
      expect(calculateChargingBatteryPercentage(0, 40, 100)).toBe(40);
    });

    it("returns target percent at 100% progress", () => {
      expect(calculateChargingBatteryPercentage(100, 40, 100)).toBe(100);
    });

    it("returns correct value at 50% progress", () => {
      // Starting at 40%, target 100%, progress 50%
      // (100 - 40) * 0.5 + 40 = 70
      expect(calculateChargingBatteryPercentage(50, 40, 100)).toBe(70);
    });

    it("handles case where target equals start", () => {
      expect(calculateChargingBatteryPercentage(50, 80, 80)).toBe(80);
    });

    it("uses 100 as default target", () => {
      expect(calculateChargingBatteryPercentage(50, 0)).toBe(50);
    });

    it("clamps result to valid range", () => {
      expect(calculateChargingBatteryPercentage(150, 40, 100)).toBe(100);
      expect(calculateChargingBatteryPercentage(-10, 40, 100)).toBe(40);
    });
  });

  describe("appendChargingBatteryPercentage", () => {
    it("returns snapshot unchanged if progressPercent is null", () => {
      const snapshot = { id: "1" };
      expect(appendChargingBatteryPercentage(snapshot, null)).toEqual(snapshot);
    });

    it("returns snapshot unchanged if progressPercent is undefined", () => {
      const snapshot = { id: "1" };
      expect(appendChargingBatteryPercentage(snapshot, undefined)).toEqual(snapshot);
    });

    it("returns snapshot unchanged if startingBatteryPercent cannot be resolved", () => {
      const snapshot = { id: "1" };
      expect(appendChargingBatteryPercentage(snapshot, 50)).toEqual(snapshot);
    });

    it("adds batteryPercentage when all info is available", () => {
      const snapshot = { id: "1", startingBatteryPercent: 40 };
      const result = appendChargingBatteryPercentage(snapshot, 50);
      expect(result.batteryPercentage).toBe(70);
    });

    it("uses vehicleInfo param for battery info", () => {
      const snapshot = { id: "1" };
      const vehicleInfo = { batteryPercent: 30 };
      const result = appendChargingBatteryPercentage(snapshot, 50, vehicleInfo);
      expect(result.batteryPercentage).toBe(65);
    });

    it("calculates target from ticketKwh and batteryCapacity", () => {
      const snapshot = {
        id: "1",
        startingBatteryPercent: 20,
        ticketKwh: 30,
      };
      const vehicleInfo = { batteryCapacity: 60 };
      // Target = 20 + (30/60)*100 = 70%
      // Progress 50% from 20% to 70% = 20 + (50 * 0.5) = 45%
      const result = appendChargingBatteryPercentage(snapshot, 50, vehicleInfo);
      expect(result.batteryPercentage).toBe(45);
    });
  });
});
