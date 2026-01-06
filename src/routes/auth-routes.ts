const express = require("express");
const { check } = require("express-validator");

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
  [
    check("name").not().isEmpty(),
    check("email").normalizeEmail().isEmail(),
    check("password").isLength({ min: 6 }),
  ],
  authControllers.signup
);

router.post("/logout", authControllers.logout);

router.get("/session", authControllers.getSession);

// router.post("/me", authControllers.getMe);

module.exports = router;
