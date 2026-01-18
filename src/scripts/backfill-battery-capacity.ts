import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

import {
  backfillVehicleBatteryCapacity,
  parseBatteryCapacityDefault,
} from "../services/vehicle-battery-service";

const rawDefault = process.env.BATTERY_CAPACITY_DEFAULT ?? process.argv[2];
const defaultCapacity = parseBatteryCapacityDefault(rawDefault);

if (defaultCapacity === undefined) {
  console.error(
    "Missing battery capacity default. Set BATTERY_CAPACITY_DEFAULT or pass a value (number or 'null')."
  );
  process.exit(1);
}

const buildMongoUri = () => {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;
  if (!DB_USER || !DB_PASSWORD || !DB_HOST || !DB_NAME) {
    throw new Error("Missing database credentials.");
  }

  return `mongodb+srv://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/?appName=${DB_NAME}`;
};

const run = async () => {
  const uri = buildMongoUri();
  await mongoose.connect(uri);

  try {
    const result = await backfillVehicleBatteryCapacity(defaultCapacity);
    const modified =
      typeof result.modifiedCount === "number" ? result.modifiedCount : 0;
    console.log(
      `Backfilled batteryCapacity for ${modified} vehicles using value ${defaultCapacity}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
});
