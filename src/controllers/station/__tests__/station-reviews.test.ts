import {
  listStationReviews,
  getMyStationReview,
  createOrUpdateStationReview,
  deleteMyStationReview,
  adminDeleteStationReview,
} from "../station-reviews";
import Station from "../../../models/station";
import StationReview from "../../../models/station-review";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";
import { invalidateStation } from "../../../services/station-cache";
import {
  hasCompletedChargingAtStation,
  recomputeStationRating,
  getStationReviewSummary,
  buildReviewPayload,
} from "../../../services/station-review-service";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("../../../models/station", () => {
  const StationMock = jest.fn() as jest.Mock & { exists: jest.Mock };
  StationMock.exists = jest.fn();
  return { __esModule: true, default: StationMock };
});

jest.mock("../../../models/station-review", () => {
  const ReviewMock = jest.fn() as jest.Mock & {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOneAndDelete: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  ReviewMock.find = jest.fn();
  ReviewMock.findOne = jest.fn();
  ReviewMock.findOneAndUpdate = jest.fn();
  ReviewMock.findOneAndDelete = jest.fn();
  ReviewMock.findByIdAndDelete = jest.fn();
  return { __esModule: true, default: ReviewMock };
});

jest.mock("../../../services/station-cache", () => ({
  invalidateStation: jest.fn(),
}));

jest.mock("../../../services/station-review-service", () => ({
  hasCompletedChargingAtStation: jest.fn(),
  recomputeStationRating: jest.fn(),
  getStationReviewSummary: jest.fn(),
  buildReviewPayload: jest.fn((review: any) => ({
    id: review?._id ?? review?.id ?? null,
    shaped: true,
  })),
}));

const StationMock = Station as unknown as jest.Mock & { exists: jest.Mock };
const ReviewMock = StationReview as unknown as jest.Mock & {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  findOneAndDelete: jest.Mock;
  findByIdAndDelete: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const invalidateStationMock = invalidateStation as jest.Mock;
const hasChargedMock = hasCompletedChargingAtStation as jest.Mock;
const recomputeMock = recomputeStationRating as jest.Mock;
const summaryMock = getStationReviewSummary as jest.Mock;

type MockResponse = { status: jest.Mock; json: jest.Mock };
const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const VALID_STATION = "507f1f77bcf86cd799439011";
const VALID_REVIEW = "507f1f77bcf86cd799439012";

// Chainable query stub for find().sort().skip().limit().populate().lean()
const findChain = (resolved: unknown) => {
  const q: any = {};
  q.sort = jest.fn(() => q);
  q.skip = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.populate = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(resolved));
  return q;
};

// Chainable stub for findOne().populate().lean()
const findOneChain = (resolved: unknown) => {
  const q: any = {};
  q.populate = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(resolved));
  return q;
};

beforeEach(() => {
  jest.clearAllMocks();
  validationResultMock.mockReturnValue({ isEmpty: () => true });
  recomputeMock.mockResolvedValue({ average: 4.2, count: 5 });
  summaryMock.mockResolvedValue({
    average: 4.2,
    count: 5,
    distribution: { "1": 0, "2": 0, "3": 1, "4": 1, "5": 3 },
  });
  invalidateStationMock.mockResolvedValue(undefined);
});

describe("listStationReviews", () => {
  it("returns 422 for an invalid station id", async () => {
    const req = { params: { stationId: "bad-id" }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns 404 when the station does not exist", async () => {
    StationMock.exists.mockResolvedValue(null);
    const req = { params: { stationId: VALID_STATION }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("returns reviews, summary and pagination on success", async () => {
    StationMock.exists.mockResolvedValue({ _id: VALID_STATION });
    ReviewMock.find.mockReturnValue(findChain([{ _id: "r1" }, { _id: "r2" }]));
    const req = {
      params: { stationId: VALID_STATION },
      query: { limit: "10", offset: "0" },
    };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.reviews).toHaveLength(2);
    expect(payload.summary.count).toBe(5);
    expect(payload.pagination).toEqual({ limit: 10, offset: 0, total: 5 });
  });

  it("clamps limit to the maximum", async () => {
    StationMock.exists.mockResolvedValue({ _id: VALID_STATION });
    const chain = findChain([]);
    ReviewMock.find.mockReturnValue(chain);
    const req = {
      params: { stationId: VALID_STATION },
      query: { limit: "9999" },
    };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(chain.limit).toHaveBeenCalledWith(100);
  });

  it("applies the parsed offset and limit to the query", async () => {
    StationMock.exists.mockResolvedValue({ _id: VALID_STATION });
    const chain = findChain([]);
    ReviewMock.find.mockReturnValue(chain);
    const req = {
      params: { stationId: VALID_STATION },
      query: { limit: "5", offset: "15" },
    };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(chain.skip).toHaveBeenCalledWith(15);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(res.json.mock.calls[0][0].pagination).toEqual({
      limit: 5,
      offset: 15,
      total: 5,
    });
  });

  it("forwards a 500 on DB failure", async () => {
    StationMock.exists.mockRejectedValue(new Error("DB"));
    const req = { params: { stationId: VALID_STATION }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await listStationReviews(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(500);
  });
});

describe("getMyStationReview", () => {
  it("returns 422 when validation fails", async () => {
    validationResultMock.mockReturnValue({ isEmpty: () => false });
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    const req = { params: { stationId: VALID_STATION }, session: {} };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("returns 422 for an invalid station id", async () => {
    const req = { params: { stationId: "bad-id" }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns the user's review when present", async () => {
    ReviewMock.findOne.mockReturnValue(findOneChain({ _id: "r1" }));
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(res.json.mock.calls[0][0].review).toEqual({ id: "r1", shaped: true });
  });

  it("returns null when the user has no review", async () => {
    ReviewMock.findOne.mockReturnValue(findOneChain(null));
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(res.json).toHaveBeenCalledWith({ review: null });
  });

  it("forwards a 500 on DB failure", async () => {
    const chain = findOneChain(null);
    chain.lean = jest.fn(() => Promise.reject(new Error("DB")));
    ReviewMock.findOne.mockReturnValue(chain);
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await getMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(500);
  });
});

describe("createOrUpdateStationReview", () => {
  const baseReq = () => ({
    params: { stationId: VALID_STATION },
    user: { id: "u1" },
    body: { rating: 5, comment: "Great" },
  });

  it("returns 422 when validation fails", async () => {
    validationResultMock.mockReturnValue({ isEmpty: () => false });
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    const req = { ...baseReq(), user: undefined, session: {} };
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("returns 422 for an invalid station id", async () => {
    const req = { ...baseReq(), params: { stationId: "bad-id" } };
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns 404 when the station does not exist", async () => {
    StationMock.exists.mockResolvedValue(null);
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("returns 403 when the user has not charged at the station", async () => {
    StationMock.exists.mockResolvedValue({ _id: VALID_STATION });
    hasChargedMock.mockResolvedValue(false);
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(403);
  });

  const okEligible = () => {
    StationMock.exists.mockResolvedValue({ _id: VALID_STATION });
    hasChargedMock.mockResolvedValue(true);
  };

  const createdResult = {
    value: { _id: "r1", toObject: () => ({ _id: "r1" }) },
    lastErrorObject: { updatedExisting: false },
  };

  it("creates a new review (201) with the correct upsert filter/update/options", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockResolvedValue(createdResult);
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(ReviewMock.findOneAndUpdate).toHaveBeenCalledWith(
      { station: VALID_STATION, user: "u1" },
      { $set: { rating: 5, comment: "Great" } },
      expect.objectContaining({
        upsert: true,
        new: true,
        includeResultMetadata: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      })
    );
    expect(recomputeMock).toHaveBeenCalledWith(VALID_STATION);
    expect(invalidateStationMock).toHaveBeenCalledWith(VALID_STATION);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toBe("Review submitted.");
    expect(payload.summary).toEqual({ average: 4.2, count: 5 });
  });

  it("omits comment from the update when none is sent", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockResolvedValue(createdResult);
    const req = { ...baseReq(), body: { rating: 4 } };
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(req as any, res as any, next);

    expect(ReviewMock.findOneAndUpdate).toHaveBeenCalledWith(
      { station: VALID_STATION, user: "u1" },
      { $set: { rating: 4 } },
      expect.anything()
    );
  });

  it("clears the comment when an empty string is sent", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockResolvedValue(createdResult);
    const req = { ...baseReq(), body: { rating: 4, comment: "" } };
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(req as any, res as any, next);

    expect(ReviewMock.findOneAndUpdate).toHaveBeenCalledWith(
      { station: VALID_STATION, user: "u1" },
      { $set: { rating: 4, comment: "" } },
      expect.anything()
    );
  });

  it("updates an existing review (200)", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockResolvedValue({
      value: { _id: "r1", toObject: () => ({ _id: "r1" }) },
      lastErrorObject: { updatedExisting: true },
    });
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Review updated.");
  });

  it("retries once on a duplicate-key race and resolves as an update (no upsert)", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({
        value: { _id: "r1", toObject: () => ({ _id: "r1" }) },
        lastErrorObject: { updatedExisting: true },
      });
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(ReviewMock.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // The retry must NOT upsert (the doc already exists).
    expect(ReviewMock.findOneAndUpdate.mock.calls[1][2].upsert).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Review updated.");
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards a 500 on a non-duplicate DB error (no retry)", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockRejectedValue(new Error("DB"));
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    expect(ReviewMock.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].code).toBe(500);
  });

  it("still succeeds (no error) when rating sync fails post-write", async () => {
    okEligible();
    ReviewMock.findOneAndUpdate.mockResolvedValue(createdResult);
    recomputeMock.mockRejectedValueOnce(new Error("aggregate failed"));
    const res = buildRes();
    const next = jest.fn();

    await createOrUpdateStationReview(baseReq() as any, res as any, next);

    // Review was persisted; the failed denormalization must not fail the request.
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].summary).toBeUndefined();
  });
});

describe("deleteMyStationReview", () => {
  it("returns 401 when unauthenticated", async () => {
    const req = { params: { stationId: VALID_STATION }, session: {} };
    const res = buildRes();
    const next = jest.fn();

    await deleteMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(401);
  });

  it("returns 404 when the user has no review", async () => {
    ReviewMock.findOneAndDelete.mockResolvedValue(null);
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await deleteMyStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("deletes the review and recomputes aggregates", async () => {
    ReviewMock.findOneAndDelete.mockResolvedValue({ _id: "r1" });
    const req = { params: { stationId: VALID_STATION }, user: { id: "u1" } };
    const res = buildRes();
    const next = jest.fn();

    await deleteMyStationReview(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(recomputeMock).toHaveBeenCalledWith(VALID_STATION);
    expect(invalidateStationMock).toHaveBeenCalledWith(VALID_STATION);
  });
});

describe("adminDeleteStationReview", () => {
  it("returns 422 for an invalid review id", async () => {
    const req = { params: { reviewId: "bad-id" } };
    const res = buildRes();
    const next = jest.fn();

    await adminDeleteStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(422);
  });

  it("returns 404 when the review does not exist", async () => {
    ReviewMock.findByIdAndDelete.mockResolvedValue(null);
    const req = { params: { reviewId: VALID_REVIEW } };
    const res = buildRes();
    const next = jest.fn();

    await adminDeleteStationReview(req as any, res as any, next);

    expect(next.mock.calls[0][0].code).toBe(404);
  });

  it("deletes the review and recomputes the owning station", async () => {
    ReviewMock.findByIdAndDelete.mockResolvedValue({
      _id: VALID_REVIEW,
      station: { toString: () => VALID_STATION },
    });
    const req = { params: { reviewId: VALID_REVIEW } };
    const res = buildRes();
    const next = jest.fn();

    await adminDeleteStationReview(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(recomputeMock).toHaveBeenCalledWith(VALID_STATION);
    expect(invalidateStationMock).toHaveBeenCalledWith(VALID_STATION);
  });

  it("skips recompute when the deleted review has no station ref", async () => {
    ReviewMock.findByIdAndDelete.mockResolvedValue({ _id: VALID_REVIEW });
    const req = { params: { reviewId: VALID_REVIEW } };
    const res = buildRes();
    const next = jest.fn();

    await adminDeleteStationReview(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(invalidateStationMock).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].summary).toBeUndefined();
  });
});
