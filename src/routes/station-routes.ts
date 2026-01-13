import express from "express";
import { check } from "express-validator";
import { adminMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

const stationControllers = require("../controllers/station-controllers");

router.post(
  "/add-station",
  adminMiddleware,
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
    check("amenities").optional().isArray(),
    check("notes").optional().isString(),
  ],
  stationControllers.addStation
);

router.patch(
  "/update-station",
  adminMiddleware,
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
    check("amenities").optional().isArray(),
    check("notes").optional().isString(),
  ],
  stationControllers.updateStation
);

router.delete(
  "/delete-station",
  adminMiddleware,
  [check("stationId").not().isEmpty()],
  stationControllers.deleteStation
);

router.get("/", stationControllers.getStations);

module.exports = router;
