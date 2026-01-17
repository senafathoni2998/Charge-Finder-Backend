import { fileUpload } from "../middleware/fileUpload";

const express = require("express");
const { check, param } = require("express-validator");

const { adminMiddleware } = require("../middleware/authMiddleware");
const adminControllers = require("../controllers/admin-controllers");

const router = express.Router();

router.get("/users", adminMiddleware, adminControllers.getUsers);

router.post(
  "/users",
  adminMiddleware,
  [
    check("name").not().isEmpty(),
    check("email").normalizeEmail().isEmail(),
    check("password").isLength({ min: 6 }),
    check("region").optional().not().isEmpty(),
    check("role").optional().isIn(["admin", "user"]),
  ],
  adminControllers.createUser
);

router.patch(
  "/users/:userId",
  adminMiddleware,
  fileUpload.single("image"),
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

router.delete(
  "/users/:userId",
  adminMiddleware,
  [param("userId").not().isEmpty()],
  adminControllers.deleteUser
);

module.exports = router;
export {};
