import express from "express";
import { check } from "express-validator";

// const express = require("express");
// const { check } = require("express-validator");

const router = express.Router();

const authControllers = require("../controllers/auth-controllers");

router.patch(
  "/update-password",
  [check("email").normalizeEmail().isEmail(), check("currentPassword").not().isEmpty(), check("newPassword").isLength({ min: 6 })],
  authControllers.passwordUpdate
);

router.patch(
  "/update-profile",
  [
    check("email").optional().normalizeEmail().isEmail(),
    check("name").optional().not().isEmpty(),
    check("region").optional().not().isEmpty(),
  ],
  authControllers.profileUpdate
);

module.exports = router;