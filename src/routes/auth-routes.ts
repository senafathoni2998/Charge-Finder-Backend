import { fileUpload } from "../middleware/fileUpload";
import { createRateLimitMiddleware } from "../middleware/rateLimit";

const express = require("express");
const { check } = require("express-validator");
const { adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

const authControllers = require("../controllers/auth-controllers");

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const signupRateLimit = createRateLimitMiddleware({
  windowMs: parsePositiveInt(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  max: parsePositiveInt(process.env.SIGNUP_RATE_LIMIT_MAX, 5),
  keyPrefix: "signup",
});

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
  signupRateLimit,
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
