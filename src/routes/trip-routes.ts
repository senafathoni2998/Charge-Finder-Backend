import express from "express";
import { check } from "express-validator";

const router = express.Router();

const tripControllers = require("../controllers/trip-controllers");

// Shared validators for the planning inputs (used by both /plan and save).
const planValidators = [
  check("origin.lat").isFloat({ min: -90, max: 90 }),
  check("origin.lng").isFloat({ min: -180, max: 180 }),
  check("destination.lat").isFloat({ min: -90, max: 90 }),
  check("destination.lng").isFloat({ min: -180, max: 180 }),
  check("vehicleId").optional().not().isEmpty(),
  check("rangeKm").optional().isFloat({ min: 0 }),
  check("startBatteryPercent").optional().isFloat({ min: 0, max: 100 }),
  check("bufferPercent").optional().isFloat({ min: 0, max: 90 }),
  check("chargeToPercent").optional().isFloat({ min: 1, max: 100 }),
  check("minPowerKW").optional().isFloat({ min: 0 }),
  check("maxDetourKm").optional().isFloat({ min: 0, max: 200 }),
  check("efficiencyKwhPer100Km").optional().isFloat({ min: 1 }),
  check("connectorTypes").optional().isArray({ max: 3 }),
  check("connectorTypes.*").optional().isIn(["CCS2", "Type2", "CHAdeMO"]),
];

// Compute a plan (stateless — nothing saved).
router.post("/plan", planValidators, tripControllers.planTripHandler);

// Compute and save a plan.
router.post(
  "/",
  [...planValidators, check("name").optional().isString().isLength({ max: 120 })],
  tripControllers.saveTrip
);

// The caller's saved trips.
router.get("/", tripControllers.getMyTrips);

// A single saved trip (owner or admin).
router.get(
  "/:tripId",
  [check("tripId").not().isEmpty()],
  tripControllers.getTripById
);

// Delete a saved trip (owner or admin).
router.delete(
  "/:tripId",
  [check("tripId").not().isEmpty()],
  tripControllers.deleteTrip
);

module.exports = router;
