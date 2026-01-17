import express from "express";
import { check } from "express-validator";
import { fileUpload } from "../middleware/fileUpload";

// const express = require("express");
// const { check } = require("express-validator");

const router = express.Router();

const profileControllers = require("../controllers/profile-controllers");

router.get("/", profileControllers.getProfile);
router.get("/charging-history", profileControllers.getChargingHistory);

router.patch(
  "/update-password",
  [
    check("userId").not().isEmpty(),
    check("currentPassword").not().isEmpty(),
    check("newPassword").isLength({ min: 6 }),
  ],
  profileControllers.passwordUpdate
);

router.patch(
  "/update-profile",
  fileUpload.single("image"),
  [
    check("userId").not().isEmpty(),
    check("name").optional().not().isEmpty(),
    check("region").optional().not().isEmpty(),
  ],
  profileControllers.profileUpdate
);

module.exports = router;
