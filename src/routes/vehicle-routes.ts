import express from "express";
import { check } from "express-validator";

const router = express.Router();

const vehicleControllers = require("../controllers/vehicle-controllers");

router.post(
    "/add-vehicle",
    [
        check("email").optional().normalizeEmail().isEmail(),
        check("name").optional().not().isEmpty(),
        check("connector_type").optional().isArray({ min: 1 }),
        check("connector_type.*").optional().isString().not().isEmpty(),
        check("min_power").optional().not().isEmpty(),
    ],
    vehicleControllers.addNewVehicle
);

module.exports = router;