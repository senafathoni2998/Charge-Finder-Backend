import StationReview from "../station-review";

const USER = "507f1f77bcf86cd799439011";
const STATION = "507f1f77bcf86cd799439012";

describe("StationReview model", () => {
  it("accepts a valid review", () => {
    const review = new StationReview({
      user: USER,
      station: STATION,
      rating: 4,
      comment: "Solid charger",
    });
    expect(review.validateSync()).toBeUndefined();
  });

  it("requires user, station and rating", () => {
    const review = new StationReview({});
    const errors = review.validateSync();
    expect(errors?.errors.user).toBeDefined();
    expect(errors?.errors.station).toBeDefined();
    expect(errors?.errors.rating).toBeDefined();
  });

  it("rejects ratings outside 1-5", () => {
    const tooLow = new StationReview({ user: USER, station: STATION, rating: 0 });
    expect(tooLow.validateSync()?.errors.rating).toBeDefined();

    const tooHigh = new StationReview({ user: USER, station: STATION, rating: 6 });
    expect(tooHigh.validateSync()?.errors.rating).toBeDefined();
  });

  it("rejects comments longer than 1000 characters", () => {
    const review = new StationReview({
      user: USER,
      station: STATION,
      rating: 3,
      comment: "x".repeat(1001),
    });
    expect(review.validateSync()?.errors.comment).toBeDefined();
  });

  it("declares a unique (station, user) index", () => {
    const indexes = StationReview.schema.indexes();
    const unique = indexes.find(
      ([fields, options]) =>
        fields.station === 1 && fields.user === 1 && options?.unique
    );
    expect(unique).toBeDefined();
  });
});
