import express from "express";
import { check } from "express-validator";
import { adminMiddleware } from "../middleware/authMiddleware";
import { fileUpload } from "../middleware/fileUpload";
import { normalizeStationBody } from "../middleware/normalizeStationBody";

const router = express.Router();

const stationControllers = require("../controllers/station-controllers");

router.post(
  "/add-station",
  adminMiddleware,
  // Accepts the optional feature image as multipart; normalizeStationBody parses
  // the JSON-encoded structured fields so the validators below run unchanged.
  fileUpload.single("featuredImage"),
  normalizeStationBody,
  [
    check("name").not().isEmpty(),
    check("lat").not().isEmpty(),
    check("lng").not().isEmpty(),
    check("address").not().isEmpty(),
    check("connectors").isArray({ min: 1 }),
    check("connectors.*.type").isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("connectors.*.powerKW").not().isEmpty(),
    check("connectors.*.ports").not().isEmpty(),
    check("connectors.*.availablePorts").not().isEmpty(),
    check("status").isIn(["AVAILABLE", "BUSY", "OFFLINE"]),
    check("lastUpdatedISO").not().isEmpty(),
    check("photos").optional().isArray(),
    check("photos.*.label").optional().not().isEmpty(),
    check("photos.*.gradient").optional().not().isEmpty(),
    check("pricing").not().isEmpty(),
    check("pricing.currency").not().isEmpty(),
    check("pricing.perKwh").not().isEmpty(),
    check("pricing.fastPerKwh").optional().isFloat({ min: 0 }).toFloat(),
    check("pricing.ultraFastPerKwh").optional().isFloat({ min: 0 }).toFloat(),
    check("amenities").optional().isArray(),
    check("notes").optional().isString(),
  ],
  stationControllers.addStation
);

router.patch(
  "/update-station",
  adminMiddleware,
  fileUpload.single("featuredImage"),
  normalizeStationBody,
  [
    check("stationId").not().isEmpty(),
    check("name").optional().not().isEmpty(),
    check("lat").optional().not().isEmpty(),
    check("lng").optional().not().isEmpty(),
    check("address").optional().not().isEmpty(),
    check("connectors").optional().isArray({ min: 1 }),
    check("connectors.*.type")
      .optional()
      .isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("connectors.*.powerKW").optional().not().isEmpty(),
    check("connectors.*.ports").optional().not().isEmpty(),
    check("connectors.*.availablePorts").optional().not().isEmpty(),
    check("status").optional().isIn(["AVAILABLE", "BUSY", "OFFLINE"]),
    check("lastUpdatedISO").optional().not().isEmpty(),
    check("photos").optional().isArray(),
    check("photos.*.label").optional().not().isEmpty(),
    check("photos.*.gradient").optional().not().isEmpty(),
    check("pricing").optional().not().isEmpty(),
    check("pricing.currency").optional().not().isEmpty(),
    check("pricing.perKwh").optional().not().isEmpty(),
    check("pricing.fastPerKwh").optional().isFloat({ min: 0 }).toFloat(),
    check("pricing.ultraFastPerKwh").optional().isFloat({ min: 0 }).toFloat(),
    check("amenities").optional().isArray(),
    check("notes").optional().isString(),
    check("removeFeaturedImage").optional().isBoolean(),
  ],
  stationControllers.updateStation
);

router.post(
  "/request-ticket",
  [
    check("stationId").not().isEmpty(),
    check("connectorType").optional().isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("chargingSpeed")
      .optional()
      .isIn(["NORMAL", "FAST", "ULTRA_FAST"]),
    check("ticketKwh").optional().isFloat({ min: 0 }).toFloat(),
    check("vehicleId").optional().not().isEmpty(),
  ],
  stationControllers.requestChargingTicket
);

router.post(
  "/start-charging",
  [
    check("stationId").not().isEmpty(),
    check("connectorType").optional().isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("vehicleId").optional().not().isEmpty(),
  ],
  stationControllers.startCharging
);

router.patch(
  "/charging-progress",
  [
    check("stationId").not().isEmpty(),
    check("progressPercent").optional().isFloat({ min: 0, max: 100 }).toFloat(),
  ],
  stationControllers.updateChargingProgress
);

router.post(
  "/complete-charging",
  [
    check("stationId").not().isEmpty(),
    check("cancel").optional().isBoolean().toBoolean(),
  ],
  stationControllers.completeCharging
);

router.post(
  "/cancel-charging",
  [check("stationId").not().isEmpty()],
  stationControllers.cancelCharging
);

router.get(
  "/:stationId/active-ticket",
  [check("stationId").not().isEmpty()],
  stationControllers.getActiveTicketForStation
);

// --- Station reviews & ratings ---
// (The public reviews list — GET /api/stations/:stationId/reviews — is registered in
//  app.ts before the auth middleware, alongside the other public station reads.)

// Create or update the caller's own review. Restricted in the controller to users
// who have completed a charging session at the station.
router.post(
  "/:stationId/reviews",
  [
    check("stationId").not().isEmpty(),
    check("rating").isInt({ min: 1, max: 5 }).toInt(),
    check("comment").optional().isString().isLength({ max: 1000 }),
  ],
  stationControllers.createOrUpdateStationReview
);

// Fetch the caller's own review for a station (or null).
router.get(
  "/:stationId/reviews/me",
  [check("stationId").not().isEmpty()],
  stationControllers.getMyStationReview
);

// Delete the caller's own review.
router.delete(
  "/:stationId/reviews",
  [check("stationId").not().isEmpty()],
  stationControllers.deleteMyStationReview
);

// Admin moderation: delete any review by id.
router.delete(
  "/:stationId/reviews/:reviewId",
  adminMiddleware,
  [check("reviewId").not().isEmpty()],
  stationControllers.adminDeleteStationReview
);

router.delete(
  "/delete-station",
  adminMiddleware,
  [check("stationId").not().isEmpty()],
  stationControllers.deleteStation
);

router.get("/", stationControllers.getStations);

module.exports = router;
