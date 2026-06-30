import express from "express";
import { check } from "express-validator";
import { adminMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

const reservationControllers = require("../controllers/reservation-controllers");

// Create a reservation (book a slot).
router.post(
  "/",
  [
    check("stationId").not().isEmpty(),
    check("connectorType").isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("startTime").isISO8601().toDate(),
    check("endTime").isISO8601().toDate(),
    check("vehicleId").optional().not().isEmpty(),
    check("notes").optional().isString().isLength({ max: 500 }),
  ],
  reservationControllers.createReservation
);

// Remaining capacity for a station+connector over a window.
// (Registered before "/:reservationId" so the literal path wins.)
router.get(
  "/availability",
  [
    check("stationId").not().isEmpty(),
    check("connectorType").isIn(["CCS2", "Type2", "CHAdeMO"]),
    check("startTime").isISO8601().toDate(),
    check("endTime").isISO8601().toDate(),
  ],
  reservationControllers.getAvailability
);

// The caller's own reservations.
router.get("/", reservationControllers.getMyReservations);

// Admin moderation: all reservations for a station.
router.get(
  "/station/:stationId",
  adminMiddleware,
  [check("stationId").not().isEmpty()],
  reservationControllers.getStationReservations
);

// A single reservation (owner or admin).
router.get(
  "/:reservationId",
  [check("reservationId").not().isEmpty()],
  reservationControllers.getReservationById
);

// Cancel a reservation (owner or admin).
router.delete(
  "/:reservationId",
  [check("reservationId").not().isEmpty()],
  reservationControllers.cancelReservation
);

module.exports = router;
