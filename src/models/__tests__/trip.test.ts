import Trip from "../trip";

const USER = "507f1f77bcf86cd799439011";

const validDoc = () => ({
  user: USER,
  origin: { lat: 0, lng: 0 },
  destination: { lat: 0, lng: 5 },
  fullRangeKm: 300,
  feasible: true,
});

describe("Trip model", () => {
  it("accepts a valid trip", () => {
    expect(new Trip(validDoc()).validateSync()).toBeUndefined();
  });

  it("requires user, origin, destination, fullRangeKm and feasible", () => {
    const errors = new Trip({}).validateSync();
    expect(errors?.errors.user).toBeDefined();
    expect(errors?.errors.origin).toBeDefined();
    expect(errors?.errors.destination).toBeDefined();
    expect(errors?.errors.fullRangeKm).toBeDefined();
    expect(errors?.errors.feasible).toBeDefined();
  });

  it("requires lat/lng within a geo point", () => {
    const errors = new Trip({ ...validDoc(), origin: {} }).validateSync();
    expect(errors?.errors["origin.lat"]).toBeDefined();
    expect(errors?.errors["origin.lng"]).toBeDefined();
  });

  it("rejects a name longer than 120 characters", () => {
    const errors = new Trip({ ...validDoc(), name: "x".repeat(121) }).validateSync();
    expect(errors?.errors.name).toBeDefined();
  });

  it("declares the per-user index", () => {
    const indexes = Trip.schema.indexes();
    const userIndex = indexes.find(
      ([fields]) => fields.user === 1 && fields.createdAt === -1
    );
    expect(userIndex).toBeDefined();
  });
});
