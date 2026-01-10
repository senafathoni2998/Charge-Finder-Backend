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

router.patch(
    "/update-vehicle",
    [
        check("vehicleId").not().isEmpty(),
        check("userId").optional().not().isEmpty(),
        check("name").optional().not().isEmpty(),
        check("connector_type").optional().isArray({ min: 1 }),
        check("connector_type.*").optional().isString().not().isEmpty(),
        check("min_power").optional().not().isEmpty(),
    ],
    vehicleControllers.updateVehicle
);

router.patch(
    "/set-active-vehicle",
    [
        check("vehicleId").not().isEmpty(),
        check("userId").optional().not().isEmpty(),
        check("active").optional().isBoolean().toBoolean(),
    ],
    vehicleControllers.setActiveVehicle
);

router.delete(
    "/delete-vehicle",
    [check("vehicleId").not().isEmpty(), check("userId").optional().not().isEmpty()],
    vehicleControllers.deleteVehicle
);

router.get("/", vehicleControllers.getVehicles);

module.exports = router;
