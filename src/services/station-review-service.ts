import { Types } from "mongoose";

import StationReview from "../models/station-review";
import Station from "../models/station";
import ChargingHistory from "../models/charging-history";

export type ReviewSummary = {
  average: number;
  count: number;
  // Counts keyed by star value "1".."5".
  distribution: Record<string, number>;
};

const toObjectId = (id: string): Types.ObjectId | null => {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
};

// Round to one decimal place (e.g. 4.3333 -> 4.3) for display-friendly averages.
const roundAverage = (value: number): number => Math.round(value * 10) / 10;

/**
 * True when the user has at least one COMPLETED charging session recorded at this
 * station. This is the eligibility gate for posting a review — enforced in the
 * controller before any write. ChargingHistory is the durable record of finished
 * sessions (written on completeCharging), so it's the source of truth here.
 */
export const hasCompletedChargingAtStation = async (
  userId: string,
  stationId: string
): Promise<boolean> => {
  if (!userId || !stationId) {
    return false;
  }

  const exists = await ChargingHistory.exists({
    user: userId,
    station: stationId,
    outcome: "COMPLETED",
  });

  return Boolean(exists);
};

/**
 * Recomputes the average rating and review count for a station from its reviews and
 * writes them back to the Station document (denormalized aggregates). Computing from
 * source (rather than incrementing) keeps each individual recompute internally
 * consistent.
 *
 * Note: this is a read-then-write with no surrounding transaction, so two recomputes
 * for the same station racing can momentarily persist a stale count/average. The
 * values are eventually consistent — re-derived on the next review mutation — and the
 * public reviews-list endpoint always computes its summary live, so the authoritative
 * figure is never wrong. Concurrent reviews to the *same* station are rare enough that
 * a per-station lock isn't worth the cost here.
 *
 * @returns The fresh { average, count } that was written.
 */
export const recomputeStationRating = async (
  stationId: string
): Promise<{ average: number; count: number }> => {
  const stationObjectId = toObjectId(stationId);
  if (!stationObjectId) {
    return { average: 0, count: 0 };
  }

  const result = await StationReview.aggregate<{
    _id: null;
    avg: number;
    count: number;
  }>([
    { $match: { station: stationObjectId } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  const average = result.length ? roundAverage(result[0].avg) : 0;
  const count = result.length ? result[0].count : 0;

  await Station.findByIdAndUpdate(stationId, {
    ratingAverage: average,
    ratingCount: count,
  });

  return { average, count };
};

/**
 * Full review summary for a station: average, total count, and the per-star
 * distribution (how many 1-star, 2-star, ... reviews). Used by the public reviews
 * list endpoint.
 */
export const getStationReviewSummary = async (
  stationId: string
): Promise<ReviewSummary> => {
  const emptyDistribution: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };

  const stationObjectId = toObjectId(stationId);
  if (!stationObjectId) {
    return { average: 0, count: 0, distribution: emptyDistribution };
  }

  const rows = await StationReview.aggregate<{ _id: number; count: number }>([
    { $match: { station: stationObjectId } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);

  const distribution = { ...emptyDistribution };
  let total = 0;
  let weighted = 0;
  for (const row of rows) {
    const star = String(row._id);
    if (star in distribution) {
      distribution[star] = row.count;
    }
    total += row.count;
    weighted += row._id * row.count;
  }

  const average = total ? roundAverage(weighted / total) : 0;
  return { average, count: total, distribution };
};

type PopulatedReviewUser = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  image?: unknown;
};

const resolveId = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof (value as { toString?: () => string }).toString === "function") {
    const stringified = (value as { toString: () => string }).toString();
    return stringified === "[object Object]" ? null : stringified;
  }
  return null;
};

/**
 * Shapes a (lean or hydrated) StationReview document into the API payload, exposing
 * only the reviewer's public fields (id, name, image) when the user ref is populated.
 */
export const buildReviewPayload = (
  review: Record<string, unknown>
): Record<string, unknown> => {
  const rawUser = review.user;
  let user: Record<string, unknown> | null = null;
  // A *populated* user ref is a plain object carrying name/image. A bare ObjectId is
  // also typeof "object", so exclude ObjectId/Buffer here: otherwise resolveId would
  // read `ObjectId.id` (the raw 12-byte Buffer) and UTF-8-decode it into a garbage
  // string. Bare refs fall through to resolveId(rawUser), which stringifies an
  // ObjectId to its correct 24-char hex form.
  const isPopulatedUser =
    !!rawUser &&
    typeof rawUser === "object" &&
    !(rawUser instanceof Types.ObjectId) &&
    !Buffer.isBuffer(rawUser);
  if (isPopulatedUser) {
    const populated = rawUser as PopulatedReviewUser;
    user = {
      id: resolveId(populated._id ?? populated.id),
      name: typeof populated.name === "string" ? populated.name : null,
      image: typeof populated.image === "string" ? populated.image : null,
    };
  } else {
    user = { id: resolveId(rawUser), name: null, image: null };
  }

  return {
    id: resolveId(review.id ?? review._id),
    station: resolveId(review.station),
    user,
    rating: review.rating,
    comment: typeof review.comment === "string" ? review.comment : null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
};
