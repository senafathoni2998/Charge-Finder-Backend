import express from "express";

const router = express.Router();

const stationControllers = require("../controllers/station-controllers");

router.get("/", stationControllers.getStations);

module.exports = router;
