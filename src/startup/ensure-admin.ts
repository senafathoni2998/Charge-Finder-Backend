import bcrypt from "bcryptjs";
import User from "../models/user";
import { logger } from "../logger";

type AdminSeedConfig = {
  email: string;
  password: string;
  name: string;
  region: string;
};

function getAdminSeedConfig(): AdminSeedConfig | null {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return {
    email,
    password,
    name: process.env.ADMIN_NAME || "Admin",
    region: process.env.ADMIN_REGION || "",
  };
}

export async function ensureAdminUser() {
  try {
    const existingAdmin = await User.findOne({ role: "admin" })
      .select("email")
      .lean();

    if (existingAdmin) {
      logger.info(`Admin user exists (${existingAdmin.email})`);
      return;
    }

    const seedConfig = getAdminSeedConfig();
    if (!seedConfig) {
      logger.warn(
        "No admin user found and ADMIN_EMAIL/ADMIN_PASSWORD not set. Skipping admin creation."
      );
      return;
    }

    const existingUser = await User.findOne({ email: seedConfig.email });
    if (existingUser) {
      existingUser.role = "admin";
      await existingUser.save();
      logger.info(`Promoted user to admin (${seedConfig.email})`);
      return;
    }

    const hashedPassword = await bcrypt.hash(seedConfig.password, 12);
    const adminUser = new User({
      name: seedConfig.name,
      email: seedConfig.email,
      password: hashedPassword,
      region: seedConfig.region,
      role: "admin",
    });

    await adminUser.save();
    logger.info(`Admin user created (${seedConfig.email})`);
  } catch (err) {
    logger.error({ err }, "Failed to ensure admin user");
  }
}
