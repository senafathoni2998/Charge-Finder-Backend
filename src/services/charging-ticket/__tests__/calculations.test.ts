export {};

import {
  appendChargingEstimate,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  calculateEstimatedCompletionAt,
} from "../calculations";
import { CHARGING_DURATION_MS } from "../constants";

describe("charging-ticket/calculations", () => {
  describe("calculateChargingProgressPercent", () => {
    it("returns 0 if startedAt is null", () => {
      expect(calculateChargingProgressPercent(null)).toBe(0);
    });

    it("returns 0 if startedAt is undefined", () => {
      expect(calculateChargingProgressPercent(undefined)).toBe(0);
    });

    it("returns 0 if elapsed time is negative", () => {
      const futureDate = new Date(Date.now() + 60000);
      expect(calculateChargingProgressPercent(futureDate)).toBe(0);
    });

    it("returns 0 at the exact start time", () => {
      const now = Date.now();
      expect(calculateChargingProgressPercent(new Date(now), now)).toBe(0);
    });

    it("returns 100 if durationMs is zero", () => {
      const startedAt = new Date(Date.now() - 60000);
      expect(calculateChargingProgressPercent(startedAt, Date.now(), 0)).toBe(100);
    });

    it("returns 100 if durationMs is negative", () => {
      const startedAt = new Date(Date.now() - 60000);
      expect(calculateChargingProgressPercent(startedAt, Date.now(), -1000)).toBe(100);
    });

    it("returns 100 if durationMs is NaN", () => {
      const startedAt = new Date(Date.now() - 60000);
      expect(calculateChargingProgressPercent(startedAt, Date.now(), NaN)).toBe(100);
    });

    it("calculates correct percentage for partial progress", () => {
      const durationMs = 10000; // 10 seconds
      const startedAt = new Date(Date.now() - 5000); // 5 seconds ago
      const result = calculateChargingProgressPercent(startedAt, Date.now(), durationMs);
      expect(result).toBe(50);
    });

    it("caps at 100% when elapsed exceeds duration", () => {
      const durationMs = 10000; // 10 seconds
      const startedAt = new Date(Date.now() - 20000); // 20 seconds ago
      const result = calculateChargingProgressPercent(startedAt, Date.now(), durationMs);
      expect(result).toBe(100);
    });

    it("rounds to nearest integer", () => {
      const durationMs = 10000;
      const startedAt = new Date(Date.now() - 3333); // 33.33%
      const result = calculateChargingProgressPercent(startedAt, Date.now(), durationMs);
      expect(result).toBe(33);
    });

    it("uses CHARGING_DURATION_MS as default", () => {
      const startedAt = new Date(Date.now() - CHARGING_DURATION_MS / 2);
      const result = calculateChargingProgressPercent(startedAt);
      expect(result).toBe(50);
    });
  });

  describe("calculateEstimatedCompletionAt", () => {
    it("returns null if startedAt is null", () => {
      expect(calculateEstimatedCompletionAt(null)).toBeNull();
    });

    it("returns null if startedAt is undefined", () => {
      expect(calculateEstimatedCompletionAt(undefined)).toBeNull();
    });

    it("returns null if startedAt is invalid date", () => {
      expect(calculateEstimatedCompletionAt(new Date("invalid"))).toBeNull();
    });

    it("calculates correct completion time", () => {
      const startedAt = new Date("2024-01-01T10:00:00Z");
      const durationMs = 60000; // 1 minute
      const result = calculateEstimatedCompletionAt(startedAt, durationMs);
      expect(result).toEqual(new Date("2024-01-01T10:01:00Z"));
    });

    it("uses CHARGING_DURATION_MS as default", () => {
      const startedAt = new Date("2024-01-01T10:00:00Z");
      const result = calculateEstimatedCompletionAt(startedAt);
      expect(result).toEqual(new Date(startedAt.getTime() + CHARGING_DURATION_MS));
    });
  });

  describe("appendChargingEstimate", () => {
    it("returns snapshot unchanged if startedAt is null", () => {
      const snapshot = { id: "1" };
      expect(appendChargingEstimate(snapshot, null)).toEqual(snapshot);
    });

    it("returns snapshot unchanged if startedAt is undefined", () => {
      const snapshot = { id: "1" };
      expect(appendChargingEstimate(snapshot, undefined)).toEqual(snapshot);
    });

    it("adds estimatedCompletionAt to snapshot", () => {
      const snapshot = { id: "1" };
      const startedAt = new Date("2024-01-01T10:00:00Z");
      const result = appendChargingEstimate(snapshot, startedAt, 60000);
      
      expect(result.estimatedCompletionAt).toEqual(new Date("2024-01-01T10:01:00Z"));
      expect(result.id).toBe("1");
    });

    it("preserves existing snapshot properties", () => {
      const snapshot = { id: "1", status: "IN_PROGRESS" };
      const startedAt = new Date("2024-01-01T10:00:00Z");
      const result = appendChargingEstimate(snapshot, startedAt, 60000);
      
      expect(result.id).toBe("1");
      expect(result.status).toBe("IN_PROGRESS");
    });
  });

  describe("calculateChargingDurationMs", () => {
    it("returns max duration if batteryPercent is null", () => {
      const result = calculateChargingDurationMs(null, "NORMAL");
      expect(result).toBe(7 * 60 * 1000);
    });

    it("returns max duration if batteryPercent is undefined", () => {
      const result = calculateChargingDurationMs(undefined, "NORMAL");
      expect(result).toBe(7 * 60 * 1000);
    });

    it("returns max duration if batteryPercent is NaN", () => {
      const result = calculateChargingDurationMs(NaN, "NORMAL");
      expect(result).toBe(7 * 60 * 1000);
    });

    it("returns 0 if battery is already at 100%", () => {
      const result = calculateChargingDurationMs(100, "NORMAL");
      expect(result).toBe(0);
    });

    it("calculates correct duration for 50% battery", () => {
      // 50% remaining to 100% = 50% of max duration
      const result = calculateChargingDurationMs(50, "NORMAL");
      expect(result).toBe((7 * 60 * 1000) / 2);
    });

    it("uses FAST speed max duration", () => {
      const result = calculateChargingDurationMs(50, "FAST");
      expect(result).toBe((5 * 60 * 1000) / 2);
    });

    it("uses ULTRA_FAST speed max duration", () => {
      const result = calculateChargingDurationMs(50, "ULTRA_FAST");
      expect(result).toBe((3 * 60 * 1000) / 2);
    });

    it("respects target battery percent", () => {
      // From 40% to 80% = 40% of max duration
      const result = calculateChargingDurationMs(40, "NORMAL", 80);
      expect(result).toBe(Math.round((40 / 100) * 7 * 60 * 1000));
    });

    it("returns 0 if already at target", () => {
      const result = calculateChargingDurationMs(80, "NORMAL", 80);
      expect(result).toBe(0);
    });

    it("handles battery percent over target", () => {
      const result = calculateChargingDurationMs(90, "NORMAL", 80);
      expect(result).toBe(0);
    });

    it("clamps battery values to valid range", () => {
      const result = calculateChargingDurationMs(-10, "NORMAL", 100);
      expect(result).toBe(7 * 60 * 1000); // Starting from 0
    });
  });
});
