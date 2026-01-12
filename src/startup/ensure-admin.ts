import bcrypt from "bcryptjs";
import User from "../models/user";

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
      console.log(`Admin user exists (${existingAdmin.email})`);
      return;
    }

    const seedConfig = getAdminSeedConfig();
    if (!seedConfig) {
      console.warn(
        "No admin user found and ADMIN_EMAIL/ADMIN_PASSWORD not set. Skipping admin creation."
      );
      return;
    }

    const existingUser = await User.findOne({ email: seedConfig.email });
    if (existingUser) {
      existingUser.role = "admin";
      await existingUser.save();
      console.log(`Promoted user to admin (${seedConfig.email})`);
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
    console.log(`Admin user created (${seedConfig.email})`);
  } catch (err) {
    console.error("Failed to ensure admin user:", err);
  }
}
