import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/user";
import Vehicle from "../models/vehicle";
import ChargingHistory from "../models/charging-history";
import { DEMO_USER, DEMO_VEHICLES, DEMO_CHARGING_HISTORY } from "./data/demo-data";
import StationModel from "../models/station";
import { config } from "../config";
import { logger } from "../logger";

/**
 * Ensures demo data exists for users to try the app
 * Creates a demo user with vehicles and charging history if they don't exist
 */
export async function ensureDemoData() {
  // Check if demo data is enabled
  if (!config.enableDemoData) {
    return;
  }

  try {
    // Check if demo user already exists
    const existingUser = await User.findOne({ email: DEMO_USER.email }).lean();

    if (existingUser) {
      logger.info(`Demo user already exists (${DEMO_USER.email})`);
      return;
    }

    // Get the first station for demo history references
    const station = await StationModel.findOne().lean();

    // Create demo user
    const hashedPassword = await bcrypt.hash(DEMO_USER.password, 12);
    const demoUser = new User({
      name: DEMO_USER.name,
      email: DEMO_USER.email,
      password: hashedPassword,
      region: DEMO_USER.region,
      role: "user",
    });

    await demoUser.save();
    logger.info(`Demo user created (${DEMO_USER.email})`);

    // Create demo vehicles
    const createdVehicles = [];
    for (const vehicleData of DEMO_VEHICLES) {
      const vehicle = new Vehicle({
        ...vehicleData,
        owner: demoUser._id,
        lastBatteryUpdatedAt: new Date(),
      });
      await vehicle.save();
      createdVehicles.push(vehicle);
    }
    logger.info(`Created ${createdVehicles.length} demo vehicles`);

    // Update user with vehicles
    demoUser.vehicles = createdVehicles.map((v) => v._id);
    await demoUser.save();

    // Create demo charging history
    const historyEntries = [];
    for (const historyData of DEMO_CHARGING_HISTORY) {
      // Find matching vehicle by name
      const vehicle = createdVehicles.find(
        (v) => v.name === historyData.vehicleName
      );

      if (!vehicle) continue;

      // Create a mock ticket ID (in real app this would come from ChargingTicket)
      const mockTicketId = new mongoose.Types.ObjectId();

      const history = new ChargingHistory({
        ...historyData,
        user: demoUser._id,
        ticketId: mockTicketId,
        vehicle: vehicle._id,
        station: station?._id,
      });
      await history.save();
      historyEntries.push(history);
    }
    logger.info(`Created ${historyEntries.length} demo charging history entries`);

    logger.info("Demo data seeding completed successfully!");
  } catch (err) {
    logger.error({ err }, "Failed to seed demo data");
  }
}
