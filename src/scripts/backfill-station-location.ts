import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Station from "../models/station";
import { buildMongoUri } from "../utils/mongo-uri";

/**
 * One-off migration: populate the GeoJSON `location` field on existing stations
 * from their lat/lng so the 2dsphere index and $geoNear queries work.
 *
 * Run with: npm run backfill:station-location
 */
const run = async () => {
  await mongoose.connect(buildMongoUri());

  try {
    // Aggregation-pipeline update: set location = Point([lng, lat]) for every
    // station that has numeric lat/lng but no GeoJSON location yet.
    const filter: Record<string, unknown> = {
      lat: { $type: "number" },
      lng: { $type: "number" },
      $or: [
        { location: { $exists: false } },
        { "location.coordinates": { $exists: false } },
        { "location.coordinates": { $size: 0 } },
      ],
    };
    const pipeline: mongoose.PipelineStage[] = [
      {
        $set: {
          location: {
            type: "Point",
            coordinates: ["$lng", "$lat"],
          },
        },
      },
    ];
    const result = await Station.updateMany(filter, pipeline);

    const modified =
      typeof result.modifiedCount === "number" ? result.modifiedCount : 0;
    console.log(`Backfilled location for ${modified} station(s).`);

    // Make sure the 2dsphere index actually exists in the database.
    await Station.syncIndexes();
    console.log("Synced Station indexes (2dsphere on location).");
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error("Station location backfill failed:", err);
  process.exitCode = 1;
});
