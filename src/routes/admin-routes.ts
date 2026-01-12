const express = require("express");
const { check, param } = require("express-validator");

const { adminMiddleware } = require("../middleware/authMiddleware");
const adminControllers = require("../controllers/admin-controllers");

const router = express.Router();

router.get("/users", adminMiddleware, adminControllers.getUsers);

router.patch(
  "/users/:userId",
  adminMiddleware,
  [
    param("userId").not().isEmpty(),
    check("name").optional().not().isEmpty(),
    check("region").optional().not().isEmpty(),
    check("email").optional().normalizeEmail().isEmail(),
    check("role").optional().isIn(["admin", "user"]),
    check("password").optional().isLength({ min: 6 }),
  ],
  adminControllers.updateUser
);

module.exports = router;
export {};
