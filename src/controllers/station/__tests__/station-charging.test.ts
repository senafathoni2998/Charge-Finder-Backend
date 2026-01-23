import {
  requestChargingTicket,
  getActiveTicketForStation,
  startCharging,
  updateChargingProgress,
  cancelCharging,
  completeCharging,
} from "../station-charging";
import Station from "../../../models/station";
import User from "../../../models/user";
import ChargingTicket from "../../../models/charging-ticket";
import Vehicle from "../../../models/vehicle";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";
import mongoose from "mongoose";
import {
  adjustStationConnectorAvailability,
  appendChargingBatteryPercentage,
  buildChargingTicketPayload,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  setVehicleChargingStatus,
  setActiveVehicleChargingStatus,
  finalizeChargingTicket,
  resolveChargingDurationMsForTicket,
  updateVehicleBatteryPercentage,
} from "../../../services/charging-ticket-service";
import { recordChargingHistory } from "../../../services/charging-history-service";
import {
  broadcastChargingProgress,
  buildChargingProgressKey,
  clearChargingProgressTimer,
  ensureChargingProgressTimer,
} from "../../../realtime/charging-progress";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("mongoose", () => ({
  __esModule: true,
  default: { startSession: jest.fn() },
}));

jest.mock("../../../models/station", () => {
  const StationMock = jest.fn() as jest.Mock & { findById: jest.Mock };
  StationMock.findById = jest.fn();
  return { __esModule: true, default: StationMock };
});

jest.mock("../../../models/user", () => {
  const UserMock = jest.fn() as jest.Mock & { findById: jest.Mock };
  UserMock.findById = jest.fn();
  return { __esModule: true, default: UserMock };
});

jest.mock("../../../models/charging-ticket", () => {
  const ChargingTicketMock = jest.fn() as jest.Mock & { findOne: jest.Mock };
  ChargingTicketMock.findOne = jest.fn();
  return { __esModule: true, default: ChargingTicketMock };
});

jest.mock("../../../models/vehicle", () => {
  const VehicleMock = jest.fn() as jest.Mock & { findOne: jest.Mock };
  VehicleMock.findOne = jest.fn();
  return { __esModule: true, default: VehicleMock };
});

jest.mock("../../../services/charging-ticket-service", () => ({
  adjustStationConnectorAvailability: jest.fn(),
  appendChargingBatteryPercentage: jest.fn(),
  buildChargingTicketPayload: jest.fn(),
  calculateChargingDurationMs: jest.fn(),
  calculateChargingProgressPercent: jest.fn(),
  setVehicleChargingStatus: jest.fn(),
  setActiveVehicleChargingStatus: jest.fn(),
  finalizeChargingTicket: jest.fn(),
  resolveChargingDurationMsForTicket: jest.fn(),
  updateVehicleBatteryPercentage: jest.fn(),
}));

jest.mock("../../../services/charging-history-service", () => ({
  recordChargingHistory: jest.fn(),
}));

jest.mock("../../../realtime/charging-progress", () => ({
  broadcastChargingProgress: jest.fn(),
  buildChargingProgressKey: jest.fn(),
  clearChargingProgressTimer: jest.fn(),
  ensureChargingProgressTimer: jest.fn(),
}));

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const buildSortQuery = (result: unknown) => ({
  sort: jest.fn().mockResolvedValue(result),
});

const buildSelectQuery = (result: unknown) => ({
  select: jest.fn().mockResolvedValue(result),
});

const StationMock = Station as unknown as jest.Mock & { findById: jest.Mock };
const UserMock = User as unknown as jest.Mock & { findById: jest.Mock };
const ChargingTicketMock = ChargingTicket as unknown as jest.Mock & {
  findOne: jest.Mock;
};
const VehicleMock = Vehicle as unknown as jest.Mock & { findOne: jest.Mock };
const validationResultMock = validationResult as unknown as jest.Mock;
const mongooseMock = mongoose as unknown as { startSession: jest.Mock };

const adjustStationConnectorAvailabilityMock =
  adjustStationConnectorAvailability as jest.Mock;
const appendChargingBatteryPercentageMock =
  appendChargingBatteryPercentage as jest.Mock;
const buildChargingTicketPayloadMock = buildChargingTicketPayload as jest.Mock;
const calculateChargingDurationMsMock = calculateChargingDurationMs as jest.Mock;
const calculateChargingProgressPercentMock =
  calculateChargingProgressPercent as jest.Mock;
const setVehicleChargingStatusMock = setVehicleChargingStatus as jest.Mock;
const setActiveVehicleChargingStatusMock =
  setActiveVehicleChargingStatus as jest.Mock;
const finalizeChargingTicketMock = finalizeChargingTicket as jest.Mock;
const resolveChargingDurationMsForTicketMock =
  resolveChargingDurationMsForTicket as jest.Mock;
const updateVehicleBatteryPercentageMock =
  updateVehicleBatteryPercentage as jest.Mock;
const recordChargingHistoryMock = recordChargingHistory as jest.Mock;
const broadcastChargingProgressMock = broadcastChargingProgress as jest.Mock;
const buildChargingProgressKeyMock = buildChargingProgressKey as jest.Mock;
const clearChargingProgressTimerMock = clearChargingProgressTimer as jest.Mock;
const ensureChargingProgressTimerMock = ensureChargingProgressTimer as jest.Mock;

describe("station-charging controllers", () => {
  beforeEach(() => {
    StationMock.findById.mockReset();
    UserMock.findById.mockReset();
    ChargingTicketMock.mockReset();
    ChargingTicketMock.findOne.mockReset();
    VehicleMock.findOne.mockReset();
    validationResultMock.mockReset();
    mongooseMock.startSession.mockReset();
    adjustStationConnectorAvailabilityMock.mockReset();
    appendChargingBatteryPercentageMock.mockReset();
    buildChargingTicketPayloadMock.mockReset();
    calculateChargingDurationMsMock.mockReset();
    calculateChargingProgressPercentMock.mockReset();
    setVehicleChargingStatusMock.mockReset();
    setActiveVehicleChargingStatusMock.mockReset();
    finalizeChargingTicketMock.mockReset();
    resolveChargingDurationMsForTicketMock.mockReset();
    updateVehicleBatteryPercentageMock.mockReset();
    recordChargingHistoryMock.mockReset();
    broadcastChargingProgressMock.mockReset();
    buildChargingProgressKeyMock.mockReset();
    clearChargingProgressTimerMock.mockReset();
    ensureChargingProgressTimerMock.mockReset();

    validationResultMock.mockReturnValue({ isEmpty: () => true });
    buildChargingTicketPayloadMock.mockResolvedValue(null);
    resolveChargingDurationMsForTicketMock.mockResolvedValue(10000);
    calculateChargingProgressPercentMock.mockReturnValue(0);
    appendChargingBatteryPercentageMock.mockImplementation((ticket) => ticket);
    buildChargingProgressKeyMock.mockReturnValue("progress-key");
    adjustStationConnectorAvailabilityMock.mockResolvedValue({ ok: true });
    setVehicleChargingStatusMock.mockResolvedValue(undefined);
    setActiveVehicleChargingStatusMock.mockResolvedValue(undefined);
    updateVehicleBatteryPercentageMock.mockResolvedValue(undefined);
    finalizeChargingTicketMock.mockResolvedValue(undefined);
    recordChargingHistoryMock.mockResolvedValue(undefined);
  });

  it("creates a charging ticket request", async () => {
    const stationDoc = {
      _id: "station-1",
      connectors: [{ type: "CCS2", powerKW: 120 }],
    };
    StationMock.findById.mockResolvedValue(stationDoc);

    const userDoc = {
      _id: "user-1",
      tickets: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    UserMock.findById.mockResolvedValue(userDoc);

    const ticketDoc = {
      _id: "ticket-1",
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ id: "ticket-1" }),
    };
    ChargingTicketMock.mockImplementation(() => ticketDoc);

    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
    };
    mongooseMock.startSession.mockResolvedValue(session);

    buildChargingTicketPayloadMock.mockResolvedValue({ id: "ticket-1" });

    const req = {
      body: {
        stationId: "station-1",
        connectorType: "CCS2",
        chargingSpeed: "FAST",
        ticketKwh: 20,
      },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await requestChargingTicket(req as any, res as any, next);

    expect(ChargingTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        station: "station-1",
        user: "user-1",
        connectorType: "CCS2",
        chargingSpeed: "FAST",
        ticketKwh: 20,
      })
    );
    expect(ticketDoc.save).toHaveBeenCalledWith({ session });
    expect(userDoc.save).toHaveBeenCalledWith({ session });
    expect(session.startTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Charging ticket requested successfully!",
      ticket: { id: "ticket-1" },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the active ticket payload for a station", async () => {
    const ticketDoc = {
      chargingStatus: "REQUESTED",
      toObject: jest.fn().mockReturnValue({ id: "ticket-2" }),
    };
    ChargingTicketMock.findOne.mockReturnValue(buildSortQuery(ticketDoc));
    buildChargingTicketPayloadMock.mockResolvedValue({ id: "ticket-2" });

    const req = {
      params: { stationId: "station-1" },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await getActiveTicketForStation(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ticket: { id: "ticket-2" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("prevents starting a second charging session", async () => {
    ChargingTicketMock.findOne.mockReturnValue(
      buildSelectQuery({ _id: "active-ticket" })
    );

    const req = {
      body: { stationId: "station-1" },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await startCharging(req as any, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    const error = next.mock.calls[0][0] as HttpError;
    expect(error.code).toBe(409);
  });

  it("completes charging progress when the session is done", async () => {
    const ticketDoc = {
      id: "ticket-3",
      startedAt: new Date(Date.now() - 1000),
      status: "PAID",
      chargingStatus: "IN_PROGRESS",
      toObject: jest.fn().mockReturnValue({ id: "ticket-3" }),
      vehicle: null,
    };
    ChargingTicketMock.findOne.mockReturnValue(buildSortQuery(ticketDoc));
    calculateChargingProgressPercentMock.mockReturnValue(100);
    buildChargingTicketPayloadMock.mockResolvedValue({ id: "ticket-3" });

    const req = {
      body: { stationId: "station-1" },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await updateChargingProgress(req as any, res as any, next);

    expect(finalizeChargingTicketMock).toHaveBeenCalledWith("ticket-3", "user-1");
    expect(clearChargingProgressTimerMock).toHaveBeenCalledWith("ticket-3");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Charging completed and ticket cleared successfully!",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("cancels an active charging session", async () => {
    const ticketDoc = {
      id: "ticket-4",
      startedAt: new Date(Date.now() - 1000),
      status: "PAID",
      chargingStatus: "IN_PROGRESS",
      toObject: jest.fn().mockReturnValue({ id: "ticket-4" }),
      vehicle: null,
    };
    ChargingTicketMock.findOne.mockReturnValue(buildSortQuery(ticketDoc));
    calculateChargingProgressPercentMock.mockReturnValue(45);
    buildChargingTicketPayloadMock.mockResolvedValue({ id: "ticket-4" });

    const req = {
      body: { stationId: "station-1" },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await cancelCharging(req as any, res as any, next);

    expect(finalizeChargingTicketMock).toHaveBeenCalledWith("ticket-4", "user-1");
    expect(clearChargingProgressTimerMock).toHaveBeenCalledWith("ticket-4");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Charging cancelled and ticket cleared successfully!",
      cancelledTicket: expect.any(Object),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("completes an active charging session", async () => {
    const ticketDoc = {
      id: "ticket-5",
      status: "PAID",
      chargingStatus: "IN_PROGRESS",
      toObject: jest.fn().mockReturnValue({ id: "ticket-5" }),
      vehicle: null,
    };
    ChargingTicketMock.findOne.mockReturnValue(buildSortQuery(ticketDoc));
    buildChargingTicketPayloadMock.mockResolvedValue({ id: "ticket-5" });

    const req = {
      body: { stationId: "station-1" },
      user: { id: "user-1" },
    };
    const res = buildRes();
    const next = jest.fn();

    await completeCharging(req as any, res as any, next);

    expect(finalizeChargingTicketMock).toHaveBeenCalledWith("ticket-5", "user-1");
    expect(clearChargingProgressTimerMock).toHaveBeenCalledWith("ticket-5");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Charging completed and ticket cleared successfully!",
      completedTicket: expect.any(Object),
    });
    expect(next).not.toHaveBeenCalled();
  });
});
