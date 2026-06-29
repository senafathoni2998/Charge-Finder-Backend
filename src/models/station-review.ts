import { Schema, model, Types } from "mongoose";

// A single user's review of a charging station. Eligibility (the user must have a
// COMPLETED charging session at the station) is enforced in the controller before a
// review is written — see controllers/station/station-reviews.ts. The denormalized
// ratingAverage/ratingCount on the Station document is kept in sync by
// recomputeStationRating() in services/station-review-service.ts.
const stationReviewSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    station: { type: Types.ObjectId, ref: "Station", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 1000, trim: true },
  },
  { timestamps: true }
);

// One review per user per station (re-reviewing updates the existing document via
// upsert in the controller). The unique index also enforces this at the DB layer.
stationReviewSchema.index({ station: 1, user: 1 }, { unique: true });
// Hot path: a station's reviews, newest first (paginated list endpoint).
stationReviewSchema.index({ station: 1, createdAt: -1 });

export default model("StationReview", stationReviewSchema);
