export {};

// charging-ticket-service.ts is a re-export file that aggregates exports from
// the charging-ticket subdirectory. This test verifies that all expected
// exports are available and properly typed.

import {
  // Constants
  CHARGING_DURATION_MS,
  CHARGING_PERCENT_INTERVAL_MS,
  // Calculations
  appendChargingEstimate,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  calculateEstimatedCompletionAt,
  // Battery
  appendChargingBatteryPercentage,
  calculateChargingBatteryPercentage,
  // Duration
  resolveChargingDurationMsForTicket,
  resolveChargingDurationMsFromSnapshot,
  // Payload
  buildChargingTicketPayload,
  // Persistence
  adjustStationConnectorAvailability,
  clearChargingStatusForUserVehicles,
  finalizeChargingTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
  updateVehicleBatteryPercentage,
} from "../charging-ticket-service";

describe("charging-ticket-service (re-exports)", () => {
  describe("constants exports", () => {
    it("exports CHARGING_DURATION_MS", () => {
      expect(CHARGING_DURATION_MS).toBeDefined();
      expect(typeof CHARGING_DURATION_MS).toBe("number");
    });

    it("exports CHARGING_PERCENT_INTERVAL_MS", () => {
      expect(CHARGING_PERCENT_INTERVAL_MS).toBeDefined();
      expect(typeof CHARGING_PERCENT_INTERVAL_MS).toBe("number");
    });
  });

  describe("calculations exports", () => {
    it("exports appendChargingEstimate", () => {
      expect(appendChargingEstimate).toBeDefined();
      expect(typeof appendChargingEstimate).toBe("function");
    });

    it("exports calculateChargingDurationMs", () => {
      expect(calculateChargingDurationMs).toBeDefined();
      expect(typeof calculateChargingDurationMs).toBe("function");
    });

    it("exports calculateChargingProgressPercent", () => {
      expect(calculateChargingProgressPercent).toBeDefined();
      expect(typeof calculateChargingProgressPercent).toBe("function");
    });

    it("exports calculateEstimatedCompletionAt", () => {
      expect(calculateEstimatedCompletionAt).toBeDefined();
      expect(typeof calculateEstimatedCompletionAt).toBe("function");
    });
  });

  describe("battery exports", () => {
    it("exports appendChargingBatteryPercentage", () => {
      expect(appendChargingBatteryPercentage).toBeDefined();
      expect(typeof appendChargingBatteryPercentage).toBe("function");
    });

    it("exports calculateChargingBatteryPercentage", () => {
      expect(calculateChargingBatteryPercentage).toBeDefined();
      expect(typeof calculateChargingBatteryPercentage).toBe("function");
    });
  });

  describe("duration exports", () => {
    it("exports resolveChargingDurationMsForTicket", () => {
      expect(resolveChargingDurationMsForTicket).toBeDefined();
      expect(typeof resolveChargingDurationMsForTicket).toBe("function");
    });

    it("exports resolveChargingDurationMsFromSnapshot", () => {
      expect(resolveChargingDurationMsFromSnapshot).toBeDefined();
      expect(typeof resolveChargingDurationMsFromSnapshot).toBe("function");
    });
  });

  describe("payload exports", () => {
    it("exports buildChargingTicketPayload", () => {
      expect(buildChargingTicketPayload).toBeDefined();
      expect(typeof buildChargingTicketPayload).toBe("function");
    });
  });

  describe("persistence exports", () => {
    it("exports adjustStationConnectorAvailability", () => {
      expect(adjustStationConnectorAvailability).toBeDefined();
      expect(typeof adjustStationConnectorAvailability).toBe("function");
    });

    it("exports clearChargingStatusForUserVehicles", () => {
      expect(clearChargingStatusForUserVehicles).toBeDefined();
      expect(typeof clearChargingStatusForUserVehicles).toBe("function");
    });

    it("exports finalizeChargingTicket", () => {
      expect(finalizeChargingTicket).toBeDefined();
      expect(typeof finalizeChargingTicket).toBe("function");
    });

    it("exports setActiveVehicleChargingStatus", () => {
      expect(setActiveVehicleChargingStatus).toBeDefined();
      expect(typeof setActiveVehicleChargingStatus).toBe("function");
    });

    it("exports setVehicleChargingStatus", () => {
      expect(setVehicleChargingStatus).toBeDefined();
      expect(typeof setVehicleChargingStatus).toBe("function");
    });

    it("exports updateVehicleBatteryPercentage", () => {
      expect(updateVehicleBatteryPercentage).toBeDefined();
      expect(typeof updateVehicleBatteryPercentage).toBe("function");
    });
  });
});
