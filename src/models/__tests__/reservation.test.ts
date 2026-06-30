import Reservation from "../reservation";

const USER = "507f1f77bcf86cd799439011";
const STATION = "507f1f77bcf86cd799439012";

const validDoc = () => ({
  user: USER,
  station: STATION,
  connectorType: "CCS2",
  startTime: new Date("2026-07-01T10:00:00.000Z"),
  endTime: new Date("2026-07-01T11:00:00.000Z"),
});

describe("Reservation model", () => {
  it("accepts a valid reservation and defaults status to ACTIVE", () => {
    const reservation = new Reservation(validDoc());
    expect(reservation.validateSync()).toBeUndefined();
    expect(reservation.get("status")).toBe("ACTIVE");
  });

  it("requires user, station, connectorType, startTime and endTime", () => {
    const errors = new Reservation({}).validateSync();
    expect(errors?.errors.user).toBeDefined();
    expect(errors?.errors.station).toBeDefined();
    expect(errors?.errors.connectorType).toBeDefined();
    expect(errors?.errors.startTime).toBeDefined();
    expect(errors?.errors.endTime).toBeDefined();
  });

  it("rejects an unknown connector type", () => {
    const reservation = new Reservation({ ...validDoc(), connectorType: "NACS" });
    expect(reservation.validateSync()?.errors.connectorType).toBeDefined();
  });

  it("rejects an unknown status", () => {
    const reservation = new Reservation({ ...validDoc(), status: "PENDING" });
    expect(reservation.validateSync()?.errors.status).toBeDefined();
  });

  it("rejects notes longer than 500 characters", () => {
    const reservation = new Reservation({ ...validDoc(), notes: "x".repeat(501) });
    expect(reservation.validateSync()?.errors.notes).toBeDefined();
  });

  it("declares the station+connector overlap index", () => {
    const indexes = Reservation.schema.indexes();
    const overlap = indexes.find(
      ([fields]) =>
        fields.station === 1 &&
        fields.connectorType === 1 &&
        fields.status === 1
    );
    expect(overlap).toBeDefined();
  });
});
