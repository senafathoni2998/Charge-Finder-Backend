export {};

import { buildChargingTicketPayload } from "../payload";

// Mock all dependencies
jest.mock("../../vehicle-battery-service", () => ({
  refreshVehicleBatterySnapshot: jest.fn((info) => Promise.resolve(info)),
}));

jest.mock("../../../models/station", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}));

jest.mock("../../../models/vehicle", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));

const Station = require("../../../models/station").default;
const Vehicle = require("../../../models/vehicle").default;
const { refreshVehicleBatterySnapshot } = require("../../vehicle-battery-service");

describe("charging-ticket/payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Station.findById.mockResolvedValue(null);
    Vehicle.findById.mockResolvedValue(null);
    Vehicle.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });
  });

  describe("buildChargingTicketPayload", () => {
    it("returns null for null ticket", async () => {
      const result = await buildChargingTicketPayload(null);
      expect(result).toBeNull();
    });

    it("returns null for undefined ticket", async () => {
      const result = await buildChargingTicketPayload(undefined);
      expect(result).toBeNull();
    });

    it("builds basic payload for simple ticket", async () => {
      const ticket = {
        id: "ticket-123",
        status: "REQUESTED",
        user: "user-123",
        station: "station-456",
      };

      const result = await buildChargingTicketPayload(ticket);

      expect(result).toBeDefined();
      expect((result as any).id).toBe("ticket-123");
      expect((result as any).status).toBe("REQUESTED");
    });

    it("includes stationInfo from fetched station", async () => {
      const mockStation = {
        id: "station-456",
        name: "Test Station",
        toObject: jest.fn().mockReturnValue({ id: "station-456", name: "Test Station" }),
      };
      Station.findById.mockResolvedValue(mockStation);

      const ticket = {
        id: "ticket-123",
        station: "station-456",
      };

      const result = await buildChargingTicketPayload(ticket);

      expect(result!.stationInfo).toEqual({ id: "station-456", name: "Test Station" });
    });

    it("includes vehicleInfo from fetched vehicle", async () => {
      const mockVehicle = {
        id: "vehicle-789",
        name: "My Car",
        batteryPercent: 50,
        toObject: jest.fn().mockReturnValue({
          id: "vehicle-789",
          name: "My Car",
          batteryPercent: 50,
        }),
      };
      Vehicle.findById.mockResolvedValue(mockVehicle);

      const ticket = {
        id: "ticket-123",
        vehicle: "vehicle-789",
      };

      const result = await buildChargingTicketPayload(ticket);

      expect(result!.vehicleInfo).toEqual({
        id: "vehicle-789",
        name: "My Car",
        batteryPercent: 50,
      });
    });

    it("fetches active vehicle if no vehicle on ticket", async () => {
      const mockActiveVehicle = {
        id: "active-vehicle",
        name: "Active Car",
        toObject: jest.fn().mockReturnValue({ id: "active-vehicle", name: "Active Car" }),
      };
      Vehicle.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockActiveVehicle),
      });

      const ticket = {
        id: "ticket-123",
        user: "user-123",
      };

      const result = await buildChargingTicketPayload(ticket, { userId: "user-123" });

      expect(Vehicle.findOne).toHaveBeenCalledWith({ owner: "user-123", active: true });
    });

    it("adds chargingDurationMs to payload", async () => {
      const ticket = {
        id: "ticket-123",
        startingBatteryPercent: 50,
      };

      const result = await buildChargingTicketPayload(ticket);

      expect((result as any).chargingDurationMs).toBeDefined();
      expect(typeof (result as any).chargingDurationMs).toBe("number");
    });

    it("adds estimatedCompletionAt for in-progress tickets", async () => {
      const startedAt = new Date("2024-01-01T10:00:00Z");
      const ticket = {
        id: "ticket-123",
        startedAt,
        chargingStatus: "IN_PROGRESS",
      };

      const result = await buildChargingTicketPayload(ticket);

      expect((result as any).estimatedCompletionAt).toBeDefined();
    });

    it("adds batteryPercentage when progress and battery info available", async () => {
      const mockVehicle = {
        id: "vehicle-789",
        batteryPercent: 40,
        toObject: jest.fn().mockReturnValue({
          id: "vehicle-789",
          batteryPercent: 40,
        }),
      };
      Vehicle.findById.mockResolvedValue(mockVehicle);
      refreshVehicleBatterySnapshot.mockResolvedValue({ batteryPercent: 40 });

      const ticket = {
        id: "ticket-123",
        vehicle: "vehicle-789",
        progressPercent: 50,
        startingBatteryPercent: 40,
      };

      const result = await buildChargingTicketPayload(ticket);

      expect((result as any).batteryPercentage).toBeDefined();
    });

    it("uses options.userId if provided", async () => {
      const ticket = {
        id: "ticket-123",
      };

      await buildChargingTicketPayload(ticket, { userId: "option-user" });

      expect(Vehicle.findOne).toHaveBeenCalledWith({ owner: "option-user", active: true });
    });

    it("uses options.stationId if provided", async () => {
      const ticket = {
        id: "ticket-123",
      };

      await buildChargingTicketPayload(ticket, { stationId: "option-station" });

      expect(Station.findById).toHaveBeenCalledWith("option-station");
    });

    it("handles ticket with toObject method", async () => {
      const ticket = {
        id: "ticket-123",
        status: "PAID",
        toObject: jest.fn().mockReturnValue({ id: "ticket-123", status: "PAID" }),
      };

      const result = await buildChargingTicketPayload(ticket);

      expect(ticket.toObject).toHaveBeenCalledWith({ getters: true });
      expect((result as any).status).toBe("PAID");
    });

    it("calls refreshVehicleBatterySnapshot on vehicle info", async () => {
      const mockVehicle = {
        id: "vehicle-789",
        batteryPercent: 50,
        toObject: jest.fn().mockReturnValue({ id: "vehicle-789", batteryPercent: 50 }),
      };
      Vehicle.findById.mockResolvedValue(mockVehicle);
      refreshVehicleBatterySnapshot.mockResolvedValue({
        id: "vehicle-789",
        batteryPercent: 55, // Updated
      });

      const ticket = {
        id: "ticket-123",
        vehicle: "vehicle-789",
      };

      const result = await buildChargingTicketPayload(ticket);

      expect(refreshVehicleBatterySnapshot).toHaveBeenCalled();
      expect(result!.vehicleInfo).toEqual({ id: "vehicle-789", batteryPercent: 55 });
    });
  });
});
