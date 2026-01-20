// Charging ticket service exports are grouped in smaller modules.
export type { ChargingSpeed } from "./charging-ticket/constants";
export {
  CHARGING_DURATION_MS,
  CHARGING_PERCENT_INTERVAL_MS,
} from "./charging-ticket/constants";
export {
  appendChargingEstimate,
  calculateChargingDurationMs,
  calculateChargingProgressPercent,
  calculateEstimatedCompletionAt,
} from "./charging-ticket/calculations";
export {
  appendChargingBatteryPercentage,
  calculateChargingBatteryPercentage,
} from "./charging-ticket/battery";
export {
  resolveChargingDurationMsForTicket,
  resolveChargingDurationMsFromSnapshot,
} from "./charging-ticket/duration";
export { buildChargingTicketPayload } from "./charging-ticket/payload";
export type { VehicleChargingStatus } from "./charging-ticket/persistence";
export {
  adjustStationConnectorAvailability,
  clearChargingStatusForUserVehicles,
  finalizeChargingTicket,
  setActiveVehicleChargingStatus,
  setVehicleChargingStatus,
  updateVehicleBatteryPercentage,
} from "./charging-ticket/persistence";
