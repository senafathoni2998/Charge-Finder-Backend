export {};

import {
  adjustStationConnectorAvailability,
  clearChargingStatusForUserVehicles,
  finalizeChargingTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
  updateVehicleBatteryPercentage,
} from "../persistence";

// Mock mongoose
jest.mock("mongoose", () => ({
  startSession: jest.fn(),
}));

// Mock models
jest.mock("../../../models/charging-ticket", () => ({
  __esModule: true,
  default: {
    findOneAndDelete: jest.fn(),
  },
}));

jest.mock("../../../models/station", () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
  },
}));

jest.mock("../../../models/user", () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
  },
}));

jest.mock("../../../models/vehicle", () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock("../../vehicle-battery-service", () => ({
  calculateBatteryStatus: jest.fn((percent) => {
    if (percent >= 80) return "HIGH";
    if (percent >= 20) return "NORMAL";
    return "LOW";
  }),
}));

jest.mock("../../charging-history-service", () => ({
  recordChargingHistory: jest.fn(),
}));

const mongoose = require("mongoose");
const ChargingTicket = require("../../../models/charging-ticket").default;
const Station = require("../../../models/station").default;
const User = require("../../../models/user").default;
const Vehicle = require("../../../models/vehicle").default;
const { recordChargingHistory } = require("../../charging-history-service");

describe("charging-ticket/persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Vehicle.updateOne.mockResolvedValue({ matchedCount: 1 });
    Vehicle.updateMany.mockResolvedValue({ matchedCount: 1 });
    Station.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  describe("updateVehicleBatteryPercentage", () => {
    it("returns { ok: false } if vehicleId is null", async () => {
      const result = await updateVehicleBatteryPercentage(null, 50);
      expect(result).toEqual({ ok: false });
      expect(Vehicle.updateOne).not.toHaveBeenCalled();
    });

    it("returns { ok: false } if vehicleId is undefined", async () => {
      const result = await updateVehicleBatteryPercentage(undefined, 50);
      expect(result).toEqual({ ok: false });
    });

    it("returns { ok: false } if batteryPercent is null", async () => {
      const result = await updateVehicleBatteryPercentage("vehicle-123", null);
      expect(result).toEqual({ ok: false });
    });

    it("returns { ok: false } if batteryPercent is NaN", async () => {
      const result = await updateVehicleBatteryPercentage("vehicle-123", NaN);
      expect(result).toEqual({ ok: false });
    });

    it("updates vehicle with normalized percentage", async () => {
      const result = await updateVehicleBatteryPercentage("vehicle-123", 75.6);

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-123" },
        {
          $set: {
            batteryPercent: 76, // Rounded
            batteryStatus: "NORMAL",
            lastBatteryUpdatedAt: expect.any(Date),
          },
        },
        undefined
      );
      expect(result).toEqual({ ok: true, batteryPercent: 76 });
    });

    it("clamps battery percent to valid range", async () => {
      await updateVehicleBatteryPercentage("vehicle-123", 150);

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-123" },
        expect.objectContaining({
          $set: expect.objectContaining({
            batteryPercent: 100,
          }),
        }),
        undefined
      );
    });

    it("returns { ok: false } if vehicle not found", async () => {
      Vehicle.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await updateVehicleBatteryPercentage("nonexistent", 50);

      expect(result).toEqual({ ok: false, batteryPercent: 50 });
    });

    it("passes session if provided", async () => {
      const mockSession = { id: "session" };
      await updateVehicleBatteryPercentage("vehicle-123", 50, mockSession as any);

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { session: mockSession }
      );
    });
  });

  describe("setVehicleChargingStatus", () => {
    it("returns { ok: false } if vehicleId is empty", async () => {
      const result = await setVehicleChargingStatus("", "CHARGING");
      expect(result).toEqual({ ok: false });
    });

    it("updates vehicle charging status", async () => {
      const result = await setVehicleChargingStatus("vehicle-123", "CHARGING");

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-123" },
        { $set: { chargingStatus: "CHARGING", lastBatteryUpdatedAt: expect.any(Date) } },
        undefined
      );
      expect(result).toEqual({ ok: true });
    });

    it("sets IDLE status", async () => {
      await setVehicleChargingStatus("vehicle-123", "IDLE");

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-123" },
        expect.objectContaining({ $set: expect.objectContaining({ chargingStatus: "IDLE" }) }),
        undefined
      );
    });

    it("returns { ok: false } if vehicle not found", async () => {
      Vehicle.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await setVehicleChargingStatus("nonexistent", "CHARGING");
      expect(result).toEqual({ ok: false });
    });
  });

  describe("setActiveVehicleChargingStatus", () => {
    it("returns { ok: false } if userId is empty", async () => {
      const result = await setActiveVehicleChargingStatus("", "CHARGING");
      expect(result).toEqual({ ok: false });
    });

    it("updates active vehicle for user", async () => {
      const result = await setActiveVehicleChargingStatus("user-123", "CHARGING");

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { owner: "user-123", active: true },
        { $set: { chargingStatus: "CHARGING", lastBatteryUpdatedAt: expect.any(Date) } },
        undefined
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("clearChargingStatusForUserVehicles", () => {
    it("does nothing if userId is empty", async () => {
      await clearChargingStatusForUserVehicles("");
      expect(Vehicle.updateMany).not.toHaveBeenCalled();
    });

    it("clears charging status for all user vehicles", async () => {
      await clearChargingStatusForUserVehicles("user-123");

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { owner: "user-123", chargingStatus: "CHARGING" },
        { $set: { chargingStatus: "IDLE", lastBatteryUpdatedAt: expect.any(Date) } },
        undefined
      );
    });
  });

  describe("adjustStationConnectorAvailability", () => {
    it("returns { ok: false, reason: not_found } for missing params", async () => {
      expect(await adjustStationConnectorAvailability("", "CCS2", 1)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await adjustStationConnectorAvailability("station-123", "", 1)).toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("returns { ok: false, reason: not_found } for zero delta", async () => {
      const result = await adjustStationConnectorAvailability("station-123", "CCS2", 0);
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    it("increments available ports for positive delta", async () => {
      const result = await adjustStationConnectorAvailability("station-123", "CCS2", 1);

      expect(Station.updateOne).toHaveBeenCalledWith(
        { _id: "station-123", connectors: { $elemMatch: { type: "CCS2" } } },
        {
          $inc: { "connectors.$.availablePorts": 1 },
          $set: { lastUpdatedISO: expect.any(String) },
        },
        undefined
      );
      expect(result).toEqual({ ok: true });
    });

    it("decrements available ports for negative delta", async () => {
      const result = await adjustStationConnectorAvailability("station-123", "CCS2", -1);

      expect(Station.updateOne).toHaveBeenCalledWith(
        {
          _id: "station-123",
          connectors: {
            $elemMatch: { type: "CCS2", availablePorts: { $gt: 0 } },
          },
        },
        {
          $inc: { "connectors.$.availablePorts": -1 },
          $set: { lastUpdatedISO: expect.any(String) },
        },
        undefined
      );
    });

    it("stamps a fresh lastUpdatedISO on every adjustment", async () => {
      const before = Date.now();
      await adjustStationConnectorAvailability("station-123", "CCS2", -1);

      const [, update] = Station.updateOne.mock.calls[0];
      const stamped = Date.parse(update.$set.lastUpdatedISO);
      expect(Number.isNaN(stamped)).toBe(false);
      expect(stamped).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("returns { ok: false, reason: no_available_ports } when decrement fails", async () => {
      Station.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await adjustStationConnectorAvailability("station-123", "CCS2", -1);

      expect(result).toEqual({ ok: false, reason: "no_available_ports" });
    });

    it("returns { ok: false, reason: not_found } when increment fails", async () => {
      Station.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await adjustStationConnectorAvailability("station-123", "CCS2", 1);

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  describe("finalizeChargingTicket", () => {
    let mockSession: any;

    beforeEach(() => {
      mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
      };
      mongoose.startSession.mockResolvedValue(mockSession);

      ChargingTicket.findOneAndDelete.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          connectorType: "CCS2",
          station: "station-123",
          vehicle: "vehicle-789",
          portReserved: true,
        }),
      });
      User.updateOne.mockResolvedValue({ matchedCount: 1 });
      Station.updateOne.mockResolvedValue({ matchedCount: 1 });
      Vehicle.updateOne.mockResolvedValue({ matchedCount: 1 });
    });

    it("starts a transaction", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(mongoose.startSession).toHaveBeenCalled();
      expect(mockSession.startTransaction).toHaveBeenCalled();
    });

    it("deletes the charging ticket", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(ChargingTicket.findOneAndDelete).toHaveBeenCalledWith({ _id: "ticket-123" });
    });

    it("removes ticket from user", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(User.updateOne).toHaveBeenCalledWith(
        { _id: "user-123" },
        { $pull: { tickets: "ticket-123" } },
        { session: mockSession }
      );
    });

    it("restores station connector availability", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(Station.updateOne).toHaveBeenCalled();
    });

    it("does NOT restore a port for a ticket that never reserved one", async () => {
      ChargingTicket.findOneAndDelete.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          connectorType: "CCS2",
          station: "station-123",
          vehicle: "vehicle-789",
          portReserved: false,
        }),
      });

      await finalizeChargingTicket("ticket-123", "user-123");

      expect(Station.updateOne).not.toHaveBeenCalled();
    });

    it("records history and updates battery inside the transaction when options are provided", async () => {
      await finalizeChargingTicket("ticket-123", "user-123", {
        ticketSnapshot: { id: "ticket-123", progressPercent: 100 },
        outcome: "COMPLETED",
        endedAt: new Date(),
        vehicleBatteryPercent: 87,
      });

      expect(recordChargingHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          outcome: "COMPLETED",
          session: mockSession,
        })
      );
      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-789" },
        expect.objectContaining({
          $set: expect.objectContaining({ batteryPercent: 87 }),
        }),
        { session: mockSession }
      );
    });

    it("sets vehicle to IDLE", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(Vehicle.updateOne).toHaveBeenCalledWith(
        { _id: "vehicle-789" },
        expect.objectContaining({ $set: expect.objectContaining({ chargingStatus: "IDLE" }) }),
        { session: mockSession }
      );
    });

    it("commits transaction on success", async () => {
      await finalizeChargingTicket("ticket-123", "user-123");

      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it("aborts transaction on error", async () => {
      ChargingTicket.findOneAndDelete.mockReturnValue({
        session: jest.fn().mockRejectedValue(new Error("DB error")),
      });

      await expect(finalizeChargingTicket("ticket-123", "user-123")).rejects.toThrow("DB error");

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it("clears all user vehicles if ticket has no vehicle", async () => {
      ChargingTicket.findOneAndDelete.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          connectorType: "CCS2",
          station: "station-123",
          vehicle: null,
        }),
      });

      await finalizeChargingTicket("ticket-123", "user-123");

      expect(Vehicle.updateMany).toHaveBeenCalledWith(
        { owner: "user-123", chargingStatus: "CHARGING" },
        expect.any(Object),
        { session: mockSession }
      );
    });
  });
});
