import { fileUpload } from "../middleware/fileUpload";

const express = require("express");
const { check } = require("express-validator");
const { adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

const authControllers = require("../controllers/auth-controllers");

router.post(
  "/login",
  [
    check("email").normalizeEmail().isEmail(),
    check("password").isLength({ min: 6 }),
  ],
  authControllers.login
);
router.post(
  "/signup",
  fileUpload.single("image"),
  [
    check("name").not().isEmpty(),
    check("email").normalizeEmail().isEmail(),
    check("password").isLength({ min: 6 }),
  ],
  authControllers.signup
);

router.post(
  "/admin/signup",
  adminMiddleware,
  fileUpload.single("image"),
  [
    check("name").not().isEmpty(),
    check("email").normalizeEmail().isEmail(),
    check("password").isLength({ min: 6 }),
  ],
  authControllers.createAdmin
);

router.post("/logout", authControllers.logout);

router.get("/session", authControllers.getSession);

// router.post("/me", authControllers.getMe);

module.exports = router;
export {};
