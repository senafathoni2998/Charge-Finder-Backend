export {};

import {
  CHARGING_DURATION_MS,
  CHARGING_PERCENT_INTERVAL_MS,
  resolveChargingSpeed,
  getMaxChargingDurationMs,
} from "../constants";

describe("charging-ticket/constants", () => {
  describe("CHARGING_DURATION_MS", () => {
    it("is defined and is a positive number", () => {
      expect(CHARGING_DURATION_MS).toBeDefined();
      expect(typeof CHARGING_DURATION_MS).toBe("number");
      expect(CHARGING_DURATION_MS).toBeGreaterThan(0);
    });

    it("equals 7 minutes in milliseconds (NORMAL speed)", () => {
      expect(CHARGING_DURATION_MS).toBe(7 * 60 * 1000);
    });
  });

  describe("CHARGING_PERCENT_INTERVAL_MS", () => {
    it("is defined and equals 30 seconds", () => {
      expect(CHARGING_PERCENT_INTERVAL_MS).toBe(30 * 1000);
    });
  });

  describe("resolveChargingSpeed", () => {
    it("returns 'NORMAL' for 'NORMAL' input", () => {
      expect(resolveChargingSpeed("NORMAL")).toBe("NORMAL");
    });

    it("returns 'FAST' for 'FAST' input", () => {
      expect(resolveChargingSpeed("FAST")).toBe("FAST");
    });

    it("returns 'ULTRA_FAST' for 'ULTRA_FAST' input", () => {
      expect(resolveChargingSpeed("ULTRA_FAST")).toBe("ULTRA_FAST");
    });

    it("returns 'NORMAL' for null", () => {
      expect(resolveChargingSpeed(null)).toBe("NORMAL");
    });

    it("returns 'NORMAL' for undefined", () => {
      expect(resolveChargingSpeed(undefined)).toBe("NORMAL");
    });

    it("returns 'NORMAL' for empty string", () => {
      expect(resolveChargingSpeed("")).toBe("NORMAL");
    });

    it("returns 'NORMAL' for invalid string", () => {
      expect(resolveChargingSpeed("SLOW")).toBe("NORMAL");
      expect(resolveChargingSpeed("fast")).toBe("NORMAL"); // Case sensitive
    });

    it("returns 'NORMAL' for number", () => {
      expect(resolveChargingSpeed(123)).toBe("NORMAL");
    });

    it("returns 'NORMAL' for object", () => {
      expect(resolveChargingSpeed({ speed: "FAST" })).toBe("NORMAL");
    });
  });

  describe("getMaxChargingDurationMs", () => {
    it("returns 7 minutes for NORMAL speed", () => {
      expect(getMaxChargingDurationMs("NORMAL")).toBe(7 * 60 * 1000);
    });

    it("returns 5 minutes for FAST speed", () => {
      expect(getMaxChargingDurationMs("FAST")).toBe(5 * 60 * 1000);
    });

    it("returns 3 minutes for ULTRA_FAST speed", () => {
      expect(getMaxChargingDurationMs("ULTRA_FAST")).toBe(3 * 60 * 1000);
    });

    it("returns NORMAL duration for null", () => {
      expect(getMaxChargingDurationMs(null)).toBe(7 * 60 * 1000);
    });

    it("returns NORMAL duration for undefined", () => {
      expect(getMaxChargingDurationMs(undefined)).toBe(7 * 60 * 1000);
    });

    it("returns NORMAL duration for invalid value", () => {
      expect(getMaxChargingDurationMs("invalid")).toBe(7 * 60 * 1000);
    });
  });
});
