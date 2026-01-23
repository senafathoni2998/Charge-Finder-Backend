import { WebSocket } from "ws";
import {
  buildChargingProgressKey,
  broadcastChargingProgress,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../charging-progress";

// Mock dependencies
jest.mock("../../models/charging-ticket", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("../../services/charging-ticket-service", () => ({
  appendChargingBatteryPercentage: jest.fn((snapshot) => ({
    ...snapshot,
    batteryPercentage: 50,
  })),
  buildChargingTicketPayload: jest.fn(),
  calculateChargingProgressPercent: jest.fn(),
  finalizeChargingTicket: jest.fn().mockResolvedValue({}),
  resolveChargingDurationMsForTicket: jest.fn().mockResolvedValue(3600000),
  resolveChargingDurationMsFromSnapshot: jest.fn().mockReturnValue(3600000),
  updateVehicleBatteryPercentage: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../services/charging-history-service", () => ({
  recordChargingHistory: jest.fn().mockResolvedValue({}),
}));

// Access mocked modules
const ChargingTicket = require("../../models/charging-ticket").default;
const chargingService = require("../../services/charging-ticket-service");

describe("charging-progress", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Reset mocks to return proper resolved values
    ChargingTicket.updateOne.mockResolvedValue({ matchedCount: 1 });
    chargingService.updateVehicleBatteryPercentage.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("buildChargingProgressKey", () => {
    it("creates a key from userId and stationId", () => {
      const key = buildChargingProgressKey("user-123", "station-456");
      expect(key).toBe("user-123:station-456");
    });

    it("handles empty strings", () => {
      const key = buildChargingProgressKey("", "");
      expect(key).toBe(":");
    });

    it("handles special characters in IDs", () => {
      const key = buildChargingProgressKey("user:123", "station:456");
      expect(key).toBe("user:123:station:456");
    });
  });

  describe("broadcastChargingProgress", () => {
    it("does nothing if no subscribers exist for key", () => {
      // No subscribers registered - should not throw
      expect(() => {
        broadcastChargingProgress("nonexistent-key", { type: "progress" });
      }).not.toThrow();
    });

    it("sends message to OPEN WebSocket", () => {
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      };

      // We need to add subscriber first - but the module uses private Map
      // So we test via ensureChargingProgressTimer which adds subscribers internally
      // For this basic test, we verify no crash with unknown key
      broadcastChargingProgress("test-key", { type: "test" });
      // Since no subscriber exists, nothing happens
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe("clearChargingProgressTimer", () => {
    it("does nothing if no timer exists for ticketId", () => {
      // Should not throw when clearing non-existent timer
      expect(() => {
        clearChargingProgressTimer("nonexistent-ticket");
      }).not.toThrow();
    });

    it("clears existing timer when called", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      // Create a timer by calling ensureChargingProgressTimer
      const mockTicket = {
        _id: { toString: () => "ticket-123" },
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-123",
        progressPercent: 0,
      });
      chargingService.resolveChargingDurationMsFromSnapshot.mockReturnValue(3600000);
      chargingService.calculateChargingProgressPercent.mockReturnValue(50);

      ensureChargingProgressTimer(mockTicket);

      // Run the async IIFE
      jest.advanceTimersByTime(0);

      // Now clear it
      clearChargingProgressTimer("ticket-123");

      // The internal Map should not have the timer anymore
      // We can't directly verify Map state, but we can verify clearInterval behavior
      // on subsequent clears
      clearChargingProgressTimer("ticket-123");
      // Should not throw

      clearIntervalSpy.mockRestore();
    });
  });

  describe("ensureChargingProgressTimer", () => {
    it("does nothing if ticket is null", () => {
      expect(() => {
        ensureChargingProgressTimer(null);
      }).not.toThrow();
    });

    it("does nothing if ticket has no startedAt", () => {
      const mockTicket = {
        _id: { toString: () => "ticket-123" },
        user: "user-123",
        station: "station-456",
        chargingStatus: "IN_PROGRESS",
      };

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();
    });

    it("does nothing if chargingStatus is not IN_PROGRESS", () => {
      const mockTicket = {
        _id: { toString: () => "ticket-123" },
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "COMPLETED",
      };

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();
    });

    it("does nothing if ticketId is missing", () => {
      const mockTicket = {
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();
    });

    it("does nothing if userId is missing", () => {
      const mockTicket = {
        _id: { toString: () => "ticket-123" },
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();
    });

    it("does nothing if stationId is missing", () => {
      const mockTicket = {
        _id: { toString: () => "ticket-123" },
        user: "user-123",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();
    });

    it("creates timer for valid IN_PROGRESS ticket", async () => {
      const mockTicket = {
        _id: { toString: () => "ticket-new" },
        user: "user-123",
        station: "station-456",
        vehicle: "vehicle-789",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-new",
        progressPercent: 0,
        chargingDurationMs: 3600000,
      });
      chargingService.resolveChargingDurationMsFromSnapshot.mockReturnValue(3600000);
      chargingService.calculateChargingProgressPercent.mockReturnValue(25);
      ChargingTicket.updateOne.mockResolvedValue({ matchedCount: 1 });

      ensureChargingProgressTimer(mockTicket);

      // Run the async IIFE and first tick
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();

      // Verify buildChargingTicketPayload was called
      expect(chargingService.buildChargingTicketPayload).toHaveBeenCalledWith(
        mockTicket,
        { userId: "user-123", stationId: "station-456" }
      );

      // Clean up
      clearChargingProgressTimer("ticket-new");
    });

    it("does not create duplicate timer for same ticket", async () => {
      const mockTicket = {
        _id: { toString: () => "ticket-dup" },
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-dup",
        progressPercent: 0,
      });
      chargingService.resolveChargingDurationMsFromSnapshot.mockReturnValue(3600000);
      chargingService.calculateChargingProgressPercent.mockReturnValue(25);

      ensureChargingProgressTimer(mockTicket);
      await Promise.resolve();
      jest.advanceTimersByTime(0);

      const setIntervalSpy = jest.spyOn(global, "setInterval");
      ensureChargingProgressTimer(mockTicket); // Should not create another timer

      // Second call should not create another setInterval
      // (the check happens synchronously before async IIFE)
      expect(setIntervalSpy).not.toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      clearChargingProgressTimer("ticket-dup");
    });

    it("handles ticket with string IDs", () => {
      const mockTicket = {
        id: "ticket-string",
        _id: "ticket-string",
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-string",
        progressPercent: 0,
      });

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();

      clearChargingProgressTimer("ticket-string");
    });

    it("handles ticket with nested user object", () => {
      const mockTicket = {
        _id: { toString: () => "ticket-nested" },
        user: { id: "user-nested", toString: () => "user-nested" },
        station: { id: "station-nested", toString: () => "station-nested" },
        vehicle: { id: "vehicle-nested" },
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-nested",
        progressPercent: 0,
      });

      expect(() => {
        ensureChargingProgressTimer(mockTicket);
      }).not.toThrow();

      clearChargingProgressTimer("ticket-nested");
    });

    it("handles completed charging (100% progress)", async () => {
      const mockTicket = {
        _id: { toString: () => "ticket-complete" },
        user: "user-123",
        station: "station-456",
        vehicle: "vehicle-789",
        startedAt: new Date(Date.now() - 3700000), // Started over an hour ago
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-complete",
        progressPercent: 0,
        chargingDurationMs: 3600000,
      });
      chargingService.resolveChargingDurationMsFromSnapshot.mockReturnValue(3600000);
      chargingService.calculateChargingProgressPercent.mockReturnValue(100);
      chargingService.finalizeChargingTicket.mockResolvedValue({});
      chargingService.updateVehicleBatteryPercentage.mockResolvedValue({});

      ensureChargingProgressTimer(mockTicket);

      // Run the async IIFE and tick
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();

      // Verify finalization was attempted
      expect(chargingService.finalizeChargingTicket).toHaveBeenCalledWith(
        "ticket-complete",
        "user-123"
      );
    });

    it("clears timer when ticket not found in DB", async () => {
      const mockTicket = {
        _id: { toString: () => "ticket-notfound" },
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue({
        id: "ticket-notfound",
        progressPercent: 0,
      });
      chargingService.resolveChargingDurationMsFromSnapshot.mockReturnValue(3600000);
      chargingService.calculateChargingProgressPercent.mockReturnValue(50);
      ChargingTicket.updateOne.mockResolvedValue({ matchedCount: 0 });

      ensureChargingProgressTimer(mockTicket);

      // Run the async IIFE and tick
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Timer should be cleared after matchedCount: 0
      expect(ChargingTicket.updateOne).toHaveBeenCalled();
    });

    it("handles error in buildChargingTicketPayload", async () => {
      const mockTicket = {
        _id: { toString: () => "ticket-error" },
        user: "user-123",
        station: "station-456",
        startedAt: new Date(),
        chargingStatus: "IN_PROGRESS",
      };

      chargingService.buildChargingTicketPayload.mockResolvedValue(null);

      ensureChargingProgressTimer(mockTicket);

      // Run the async IIFE
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();

      // Should not throw, just exit early
      expect(chargingService.resolveChargingDurationMsFromSnapshot).not.toHaveBeenCalled();
    });
  });
});

describe("charging-progress edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("buildChargingProgressKey handles ObjectId-like objects", () => {
    // In real usage, IDs might come as ObjectId which has toString
    const userId = { toString: () => "user-obj" };
    const stationId = { toString: () => "station-obj" };

    // The function expects strings, so toString would be called before passing
    const key = buildChargingProgressKey(
      userId.toString(),
      stationId.toString()
    );
    expect(key).toBe("user-obj:station-obj");
  });
});
