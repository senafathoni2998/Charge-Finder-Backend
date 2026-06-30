import { Types } from "mongoose";
import {
  validateReservationWindow,
  getConnectorPorts,
  countOverlappingReservations,
  userHasOverlappingReservation,
  buildReservationPayload,
  RESERVATION_LIMITS,
} from "../reservation-service";
import Reservation from "../../models/reservation";

jest.mock("../../models/reservation", () => ({
  __esModule: true,
  default: { countDocuments: jest.fn(), exists: jest.fn() },
}));

const ReservationMock = Reservation as unknown as {
  countDocuments: jest.Mock;
  exists: jest.Mock;
};

const NOW = new Date("2026-06-30T12:00:00.000Z");
const minutes = (n: number) => n * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

beforeEach(() => jest.clearAllMocks());

describe("validateReservationWindow", () => {
  it("accepts a valid future window", () => {
    expect(
      validateReservationWindow(at(minutes(30)), at(minutes(90)), NOW)
    ).toBeNull();
  });

  it("rejects invalid dates", () => {
    expect(
      validateReservationWindow(new Date("nope"), at(minutes(90)), NOW)
    ).toMatch(/invalid/i);
  });

  it("rejects end <= start", () => {
    expect(
      validateReservationWindow(at(minutes(90)), at(minutes(30)), NOW)
    ).toMatch(/after startTime/i);
  });

  it("rejects a start in the past (beyond grace)", () => {
    expect(
      validateReservationWindow(at(-minutes(5)), at(minutes(60)), NOW)
    ).toMatch(/past/i);
  });

  it("rejects a start too far in the future", () => {
    const start = at(RESERVATION_LIMITS.MAX_LEAD_MS + minutes(10));
    expect(
      validateReservationWindow(start, new Date(start.getTime() + minutes(60)), NOW)
    ).toMatch(/7 days/i);
  });

  it("rejects too-short and too-long windows", () => {
    expect(
      validateReservationWindow(at(minutes(10)), at(minutes(15)), NOW)
    ).toMatch(/too short/i);
    expect(
      validateReservationWindow(at(minutes(10)), at(minutes(10) + RESERVATION_LIMITS.MAX_DURATION_MS + minutes(1)), NOW)
    ).toMatch(/too long/i);
  });
});

describe("getConnectorPorts", () => {
  const station = {
    connectors: [
      { type: "CCS2", ports: 3 },
      { type: "Type2", ports: 1 },
    ],
  };

  it("returns the port count for a matching connector", () => {
    expect(getConnectorPorts(station, "CCS2")).toBe(3);
    expect(getConnectorPorts(station, "Type2")).toBe(1);
  });

  it("returns null when the connector type is absent", () => {
    expect(getConnectorPorts(station, "CHAdeMO")).toBeNull();
  });

  it("returns null when connectors are missing", () => {
    expect(getConnectorPorts({}, "CCS2")).toBeNull();
    expect(getConnectorPorts(null, "CCS2")).toBeNull();
  });
});

describe("countOverlappingReservations", () => {
  it("counts ACTIVE reservations overlapping the window", async () => {
    ReservationMock.countDocuments.mockResolvedValue(2);
    const start = at(minutes(30));
    const end = at(minutes(90));

    const result = await countOverlappingReservations("s1", "CCS2", start, end);

    expect(result).toBe(2);
    expect(ReservationMock.countDocuments).toHaveBeenCalledWith({
      station: "s1",
      connectorType: "CCS2",
      status: "ACTIVE",
      startTime: { $lt: end },
      endTime: { $gt: start },
    });
  });

  it("excludes a given id when provided", async () => {
    ReservationMock.countDocuments.mockResolvedValue(0);
    await countOverlappingReservations("s1", "CCS2", at(0), at(minutes(60)), "r9");
    expect(ReservationMock.countDocuments.mock.calls[0][0]._id).toEqual({
      $ne: "r9",
    });
  });
});

describe("userHasOverlappingReservation", () => {
  it("returns true when an overlapping reservation exists", async () => {
    ReservationMock.exists.mockResolvedValue({ _id: "r1" });
    const result = await userHasOverlappingReservation("u1", at(0), at(minutes(60)));
    expect(result).toBe(true);
    expect(ReservationMock.exists).toHaveBeenCalledWith(
      expect.objectContaining({ user: "u1", status: "ACTIVE" })
    );
  });

  it("returns false otherwise", async () => {
    ReservationMock.exists.mockResolvedValue(null);
    expect(await userHasOverlappingReservation("u1", at(0), at(minutes(60)))).toBe(
      false
    );
  });
});

describe("buildReservationPayload", () => {
  it("shapes populated station and vehicle refs", () => {
    const payload = buildReservationPayload(
      {
        _id: "r1",
        station: { _id: "s1", name: "Hub", address: "Main St" },
        vehicle: { _id: "v1", name: "Tesla" },
        connectorType: "CCS2",
        startTime: at(minutes(30)),
        endTime: at(minutes(90)),
        status: "ACTIVE",
        notes: "near gate",
      },
      NOW
    );
    expect(payload.station).toEqual({ id: "s1", name: "Hub", address: "Main St" });
    expect(payload.vehicle).toEqual({ id: "v1", name: "Tesla" });
    expect(payload.effectiveStatus).toBe("ACTIVE");
    expect(payload.isPast).toBe(false);
  });

  it("stringifies a bare ObjectId station ref to hex (not a Buffer)", () => {
    const stationId = new Types.ObjectId("507f1f77bcf86cd799439011");
    const payload = buildReservationPayload(
      { _id: "r1", station: stationId, endTime: at(minutes(90)), status: "ACTIVE" },
      NOW
    );
    expect(payload.station).toBe("507f1f77bcf86cd799439011");
  });

  it("marks an elapsed ACTIVE reservation as EXPIRED/past", () => {
    const payload = buildReservationPayload(
      { _id: "r1", station: "s1", endTime: at(-minutes(5)), status: "ACTIVE" },
      NOW
    );
    expect(payload.isPast).toBe(true);
    expect(payload.effectiveStatus).toBe("EXPIRED");
  });

  it("keeps CANCELLED as the effective status", () => {
    const payload = buildReservationPayload(
      { _id: "r1", station: "s1", endTime: at(minutes(90)), status: "CANCELLED" },
      NOW
    );
    expect(payload.effectiveStatus).toBe("CANCELLED");
  });
});
