/**
 * Demo data for users to try the application without signing up
 * Includes a demo user with vehicles and charging history
 */

export const DEMO_USER = {
  email: "demo@chargefinder.com",
  password: "demo123",
  name: "Demo User",
  region: "Jakarta",
};

export const DEMO_VEHICLES = [
  {
    name: "Tesla Model 3",
    connector_type: ["CCS2", "Type2"],
    min_power: 11,
    active: true,
    batteryPercent: 65,
    batteryCapacity: 75,
    chargingStatus: "IDLE",
    batteryStatus: "MEDIUM",
  },
  {
    name: "Hyundai Ioniq 5",
    connector_type: ["CCS2", "Type2"],
    min_power: 11,
    active: false,
    batteryPercent: 82,
    batteryCapacity: 72,
    chargingStatus: "IDLE",
    batteryStatus: "HIGH",
  },
];

export const DEMO_CHARGING_HISTORY = [
  {
    stationName: "Central Plaza Fast Charge",
    stationAddress: "Jl. MH Thamrin, Jakarta",
    vehicleName: "Tesla Model 3",
    connectorType: "CCS2",
    chargingSpeed: "FAST",
    ticketKwh: 28.5,
    outcome: "COMPLETED",
    progressPercent: 100,
    startingBatteryPercent: 15,
    batteryPercentage: 65,
    chargingDurationMs: 45 * 60 * 1000, // 45 minutes
    startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    endedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
  },
  {
    stationName: "Kelapa Gading Supercharge",
    stationAddress: "Kelapa Gading, Jakarta",
    vehicleName: "Tesla Model 3",
    connectorType: "CCS2",
    chargingSpeed: "ULTRA_FAST",
    ticketKwh: 35.2,
    outcome: "COMPLETED",
    progressPercent: 100,
    startingBatteryPercent: 20,
    batteryPercentage: 80,
    chargingDurationMs: 35 * 60 * 1000, // 35 minutes
    startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    endedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 35 * 60 * 1000),
  },
  {
    stationName: "Bogor Botanical Charge Hub",
    stationAddress: "Jl. Ir. H. Juanda, Bogor, West Java",
    vehicleName: "Hyundai Ioniq 5",
    connectorType: "Type2",
    chargingSpeed: "NORMAL",
    ticketKwh: 12.8,
    outcome: "COMPLETED",
    progressPercent: 100,
    startingBatteryPercent: 55,
    batteryPercentage: 82,
    chargingDurationMs: 2 * 60 * 60 * 1000, // 2 hours
    startedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    endedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
  },
  {
    stationName: "Sudirman Hub",
    stationAddress: "Jl. Jend. Sudirman, Jakarta",
    vehicleName: "Tesla Model 3",
    connectorType: "CCS2",
    chargingSpeed: "FAST",
    ticketKwh: 18.3,
    outcome: "CANCELLED",
    progressPercent: 45,
    startingBatteryPercent: 30,
    batteryPercentage: 48,
    chargingDurationMs: 22 * 60 * 1000, // 22 minutes
    startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    endedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 22 * 60 * 1000),
  },
];
