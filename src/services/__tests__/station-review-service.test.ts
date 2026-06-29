import {
  hasCompletedChargingAtStation,
  recomputeStationRating,
  getStationReviewSummary,
  buildReviewPayload,
} from "../station-review-service";
import { Types } from "mongoose";
import StationReview from "../../models/station-review";
import Station from "../../models/station";
import ChargingHistory from "../../models/charging-history";

jest.mock("../../models/station-review", () => ({
  __esModule: true,
  default: { aggregate: jest.fn() },
}));
jest.mock("../../models/station", () => ({
  __esModule: true,
  default: { findByIdAndUpdate: jest.fn() },
}));
jest.mock("../../models/charging-history", () => ({
  __esModule: true,
  default: { exists: jest.fn() },
}));

const ReviewMock = StationReview as unknown as { aggregate: jest.Mock };
const StationMock = Station as unknown as { findByIdAndUpdate: jest.Mock };
const HistoryMock = ChargingHistory as unknown as { exists: jest.Mock };

const STATION = "507f1f77bcf86cd799439011";

beforeEach(() => {
  jest.clearAllMocks();
  StationMock.findByIdAndUpdate.mockResolvedValue(undefined);
});

describe("hasCompletedChargingAtStation", () => {
  it("returns false when args are missing", async () => {
    expect(await hasCompletedChargingAtStation("", STATION)).toBe(false);
    expect(await hasCompletedChargingAtStation("u1", "")).toBe(false);
    expect(HistoryMock.exists).not.toHaveBeenCalled();
  });

  it("queries COMPLETED history for the user + station", async () => {
    HistoryMock.exists.mockResolvedValue({ _id: "h1" });
    const result = await hasCompletedChargingAtStation("u1", STATION);
    expect(result).toBe(true);
    expect(HistoryMock.exists).toHaveBeenCalledWith({
      user: "u1",
      station: STATION,
      outcome: "COMPLETED",
    });
  });

  it("returns false when no completed session exists", async () => {
    HistoryMock.exists.mockResolvedValue(null);
    expect(await hasCompletedChargingAtStation("u1", STATION)).toBe(false);
  });
});

describe("recomputeStationRating", () => {
  it("returns zeros and skips write for an invalid id", async () => {
    const result = await recomputeStationRating("bad-id");
    expect(result).toEqual({ average: 0, count: 0 });
    expect(StationMock.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rounds the average to one decimal and writes aggregates back", async () => {
    ReviewMock.aggregate.mockResolvedValue([
      { _id: null, avg: 4.3333, count: 3 },
    ]);
    const result = await recomputeStationRating(STATION);
    expect(result).toEqual({ average: 4.3, count: 3 });
    expect(StationMock.findByIdAndUpdate).toHaveBeenCalledWith(STATION, {
      ratingAverage: 4.3,
      ratingCount: 3,
    });
  });

  it("writes zeros when there are no reviews", async () => {
    ReviewMock.aggregate.mockResolvedValue([]);
    const result = await recomputeStationRating(STATION);
    expect(result).toEqual({ average: 0, count: 0 });
    expect(StationMock.findByIdAndUpdate).toHaveBeenCalledWith(STATION, {
      ratingAverage: 0,
      ratingCount: 0,
    });
  });
});

describe("getStationReviewSummary", () => {
  it("returns an empty distribution for an invalid id", async () => {
    const summary = await getStationReviewSummary("bad-id");
    expect(summary).toEqual({
      average: 0,
      count: 0,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
    });
    expect(ReviewMock.aggregate).not.toHaveBeenCalled();
  });

  it("builds distribution, count and weighted average", async () => {
    ReviewMock.aggregate.mockResolvedValue([
      { _id: 5, count: 3 },
      { _id: 4, count: 1 },
      { _id: 3, count: 1 },
    ]);
    const summary = await getStationReviewSummary(STATION);
    expect(summary.count).toBe(5);
    expect(summary.average).toBe(4.4); // (15 + 4 + 3) / 5
    expect(summary.distribution).toEqual({
      "1": 0,
      "2": 0,
      "3": 1,
      "4": 1,
      "5": 3,
    });
  });
});

describe("buildReviewPayload", () => {
  it("exposes only public fields of a populated user", () => {
    const payload = buildReviewPayload({
      _id: "r1",
      station: STATION,
      user: { _id: "u1", name: "Alice", email: "secret@x.com", image: "a.jpg" },
      rating: 5,
      comment: "Nice",
      createdAt: "t1",
      updatedAt: "t2",
    });
    expect(payload).toEqual({
      id: "r1",
      station: STATION,
      user: { id: "u1", name: "Alice", image: "a.jpg" },
      rating: 5,
      comment: "Nice",
      createdAt: "t1",
      updatedAt: "t2",
    });
    expect((payload.user as Record<string, unknown>).email).toBeUndefined();
  });

  it("handles an unpopulated user ref (id only)", () => {
    const payload = buildReviewPayload({
      _id: "r1",
      station: STATION,
      user: "u1",
      rating: 4,
      comment: null,
    });
    expect(payload.user).toEqual({ id: "u1", name: null, image: null });
    expect(payload.comment).toBeNull();
  });

  it("stringifies a bare ObjectId user ref to its hex id (not the raw Buffer)", () => {
    const userId = new Types.ObjectId("507f1f77bcf86cd799439099");
    const payload = buildReviewPayload({
      _id: new Types.ObjectId("507f1f77bcf86cd7994390aa"),
      station: STATION,
      user: userId, // unpopulated — as returned by .lean() / toObject without populate
      rating: 4,
    });
    expect((payload.user as Record<string, unknown>).id).toBe(
      "507f1f77bcf86cd799439099"
    );
    expect(payload.id).toBe("507f1f77bcf86cd7994390aa");
  });

  it("uses _id (hex) for a populated lean user whose _id is an ObjectId", () => {
    const payload = buildReviewPayload({
      _id: "r1",
      station: STATION,
      user: {
        _id: new Types.ObjectId("507f1f77bcf86cd799439099"),
        name: "Alice",
        image: "a.jpg",
      },
      rating: 5,
    });
    expect(payload.user).toEqual({
      id: "507f1f77bcf86cd799439099",
      name: "Alice",
      image: "a.jpg",
    });
  });
});
