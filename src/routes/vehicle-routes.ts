import express from "express";
import { check } from "express-validator";

const router = express.Router();

const vehicleControllers = require("../controllers/vehicle-controllers");

router.post(
    "/add-vehicle",
    [
        check("userId").optional().not().isEmpty(),
        check("name").optional().not().isEmpty(),
        check("connector_type").optional().isArray({ min: 1 }),
        check("connector_type.*").optional().isString().not().isEmpty(),
        check("min_power").optional().not().isEmpty(),
    ],
    vehicleControllers.addNewVehicle
);

router.get("/vehicles", vehicleControllers.getVehicles);

module.exports = router;