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
    // Load stations that have numeric lat/lng, then set location = Point([lng, lat])
    // for any missing a valid GeoJSON point. Coordinates are computed in JS and
    // written with a plain $set via bulkWrite (no aggregation-pipeline update).
    const stations = (await Station.find(
      { lat: { $type: "number" }, lng: { $type: "number" } } as any,
      { _id: 1, lat: 1, lng: 1, location: 1 },
    ).lean()) as Array<{
      _id: unknown;
      lat: number;
      lng: number;
      location?: { coordinates?: number[] };
    }>;

    const ops = stations
      .filter((s) => {
        const coords = s.location?.coordinates;
        return !(Array.isArray(coords) && coords.length === 2);
      })
      .map((s) => ({
        updateOne: {
          filter: { _id: s._id },
          update: {
            $set: {
              location: { type: "Point", coordinates: [s.lng, s.lat] },
            },
          },
        },
      }));

    let modified = 0;
    if (ops.length > 0) {
      const result = await Station.bulkWrite(ops as any);
      modified =
        typeof result.modifiedCount === "number"
          ? result.modifiedCount
          : ops.length;
    }
    console.log(
      `Backfilled location for ${modified} of ${stations.length} station(s).`,
    );

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
