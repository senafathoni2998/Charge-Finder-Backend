import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

import HttpError from "../../models/http-error";
import Station from "../../models/station";
import StationReview from "../../models/station-review";
import { invalidateStation } from "../../services/station-cache";
import {
  hasCompletedChargingAtStation,
  recomputeStationRating,
  getStationReviewSummary,
  buildReviewPayload,
} from "../../services/station-review-service";
import { logger } from "../../logger";

// Pagination bounds for the reviews list (mirrors the bounded reads in station-read).
const DEFAULT_REVIEW_LIMIT = 20;
const MAX_REVIEW_LIMIT = 100;

const normalizeQueryValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

const parseNonNegativeInt = (value: unknown): number | null => {
  const normalized = normalizeQueryValue(value);
  if (typeof normalized !== "string" && typeof normalized !== "number") {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
};

const resolveSessionUserId = (
  req: Request & { user?: { id: string } }
): string | undefined => req.user?.id ?? req.session?.user?.id;

const isDuplicateKeyError = (err: unknown): boolean =>
  (err as { code?: number })?.code === 11000;

// Re-derive the station's denormalized rating aggregates and drop its cache. This is a
// best-effort side-effect of a review change: the review itself is already persisted,
// and the aggregates self-heal on the next mutation (the public reviews list always
// computes its summary live), so a transient failure here must NOT fail the request.
const syncStationRating = async (
  stationId: string
): Promise<{ average: number; count: number } | null> => {
  try {
    const summary = await recomputeStationRating(stationId);
    await invalidateStation(stationId);
    return summary;
  } catch (err) {
    logger.error(
      { err, stationId },
      "Failed to sync station rating aggregates after a review change"
    );
    return null;
  }
};

// Upsert the caller's review, retrying once on a duplicate-key error. Two concurrent
// first-time reviews by the same user both miss the existing doc and try to insert;
// the unique {station,user} index fails one with E11000. On retry the document now
// exists, so the upsert resolves to a plain update — which is exactly the intended
// "one editable review per user" semantics (no spurious 409).
const upsertReview = async (
  filter: Record<string, unknown>,
  update: Record<string, unknown>
) => {
  const writeOptions = {
    new: true,
    setDefaultsOnInsert: true,
    runValidators: true,
    includeResultMetadata: true as const,
  };
  try {
    return await StationReview.findOneAndUpdate(
      filter,
      { $set: update },
      { ...writeOptions, upsert: true }
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }
    return StationReview.findOneAndUpdate(
      filter,
      { $set: update },
      writeOptions
    );
  }
};

/**
 * Lists reviews for a station (public, paginated, newest first) together with a
 * summary (average, count, per-star distribution).
 *
 * @authentication None — anyone browsing stations can read reviews.
 * @params stationId - Station ID from the URL.
 * @query limit (default 20, max 100), offset (default 0)
 */
const listStationReviews = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { stationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  const requestedLimit = parseNonNegativeInt(req.query.limit);
  const limit = Math.min(
    requestedLimit && requestedLimit > 0 ? requestedLimit : DEFAULT_REVIEW_LIMIT,
    MAX_REVIEW_LIMIT
  );
  const offset = parseNonNegativeInt(req.query.offset) ?? 0;

  try {
    const stationExists = await Station.exists({ _id: stationId });
    if (!stationExists) {
      return next(new HttpError("Station not found.", 404));
    }

    const [reviews, summary] = await Promise.all([
      StationReview.find({ station: stationId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate("user", "name image")
        .lean(),
      getStationReviewSummary(stationId),
    ]);

    res.status(200).json({
      reviews: reviews.map((review) =>
        buildReviewPayload(review as Record<string, unknown>)
      ),
      summary,
      pagination: { limit, offset, total: summary.count },
    });
  } catch (err) {
    return next(
      new HttpError("Fetching reviews failed, please try again later.", 500)
    );
  }
};

/**
 * Returns the authenticated user's own review for a station (or null if none).
 *
 * @authentication Required.
 * @params stationId - Station ID from the URL.
 */
const getMyStationReview = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const sessionUserId = resolveSessionUserId(req);
  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { stationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  let review;
  try {
    review = await StationReview.findOne({
      station: stationId,
      user: sessionUserId,
    })
      .populate("user", "name image")
      .lean();
  } catch (err) {
    return next(
      new HttpError("Fetching your review failed, please try again later.", 500)
    );
  }

  res.status(200).json({
    review: review ? buildReviewPayload(review as Record<string, unknown>) : null,
  });
};

/**
 * Creates or updates the authenticated user's review for a station.
 *
 * @authentication Required.
 * @eligibility The user must have a COMPLETED charging session at the station (403
 *   otherwise). One review per user per station — re-reviewing updates the existing
 *   document (upsert).
 * @body rating (1-5, required), comment (optional, <= 1000 chars)
 */
const createOrUpdateStationReview = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const sessionUserId = resolveSessionUserId(req);
  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { stationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  const { rating, comment } = req.body;

  let reviewDoc;
  let created = false;
  try {
    const stationExists = await Station.exists({ _id: stationId });
    if (!stationExists) {
      return next(new HttpError("Station not found.", 404));
    }

    const eligible = await hasCompletedChargingAtStation(
      sessionUserId,
      stationId
    );
    if (!eligible) {
      return next(
        new HttpError(
          "You can only review a station after completing a charging session there.",
          403
        )
      );
    }

    const update: Record<string, unknown> = { rating };
    // Only touch the comment when the client sends one; an empty string clears it.
    if (typeof comment === "string") {
      update.comment = comment;
    }

    const result = await upsertReview(
      { station: stationId, user: sessionUserId },
      update
    );

    reviewDoc = result.value;
    if (!reviewDoc) {
      return next(
        new HttpError("Saving your review failed, please try again.", 500)
      );
    }
    created = !result.lastErrorObject?.updatedExisting;
  } catch (err) {
    return next(
      new HttpError("Saving your review failed, please try again.", 500)
    );
  }

  // The review is persisted; recompute/cache are best-effort and never fail the write.
  const summary = await syncStationRating(stationId);

  res.status(created ? 201 : 200).json({
    message: created ? "Review submitted." : "Review updated.",
    review: buildReviewPayload(
      reviewDoc.toObject({ getters: true }) as Record<string, unknown>
    ),
    ...(summary ? { summary } : {}),
  });
};

/**
 * Deletes the authenticated user's own review for a station.
 *
 * @authentication Required.
 * @params stationId - Station ID from the URL.
 */
const deleteMyStationReview = async (
  req: Request & { user?: { id: string } },
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const sessionUserId = resolveSessionUserId(req);
  if (!sessionUserId) {
    return next(new HttpError("Authentication required.", 401));
  }

  const { stationId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(stationId)) {
    return next(new HttpError("Invalid station id.", 422));
  }

  let deleted;
  try {
    deleted = await StationReview.findOneAndDelete({
      station: stationId,
      user: sessionUserId,
    });
  } catch (err) {
    return next(
      new HttpError("Deleting your review failed, please try again.", 500)
    );
  }

  if (!deleted) {
    return next(new HttpError("You have not reviewed this station.", 404));
  }

  const summary = await syncStationRating(stationId);

  res.status(200).json({ message: "Review deleted.", ...(summary ? { summary } : {}) });
};

/**
 * Admin moderation: deletes any review by its id. The owning station's aggregates
 * are recomputed afterwards.
 *
 * @authentication Admin (enforced by adminMiddleware on the route).
 * @params reviewId - Review ID from the URL.
 */
const adminDeleteStationReview = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { reviewId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    return next(new HttpError("Invalid review id.", 422));
  }

  let deleted;
  try {
    deleted = await StationReview.findByIdAndDelete(reviewId);
  } catch (err) {
    return next(
      new HttpError("Deleting review failed, please try again.", 500)
    );
  }

  if (!deleted) {
    return next(new HttpError("Review not found.", 404));
  }

  const stationId = deleted.station?.toString?.();
  let summary: { average: number; count: number } | null = null;
  if (stationId) {
    summary = await syncStationRating(stationId);
  }

  res.status(200).json({ message: "Review deleted.", ...(summary ? { summary } : {}) });
};

export {
  listStationReviews,
  getMyStationReview,
  createOrUpdateStationReview,
  deleteMyStationReview,
  adminDeleteStationReview,
};
