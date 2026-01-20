import { refreshVehicleBatterySnapshot } from "../vehicle-battery-service";
import { appendChargingEstimate } from "./calculations";
import { appendChargingBatteryPercentage } from "./battery";
import { resolveChargingDurationMsFromSnapshot } from "./duration";
import {
  fetchActiveVehicleSnapshot,
  fetchStationSnapshot,
  fetchVehicleSnapshot,
  resolveId,
  toSnapshot,
} from "./snapshot";

const buildChargingTicketPayload = async (
  ticket: any,
  options: { userId?: string; stationId?: string } = {}
) => {
  if (!ticket) {
    return null;
  }

  let ticketSnapshot = toSnapshot(ticket);

  const startedAtValue =
    ticket.startedAt ?? (ticketSnapshot as { startedAt?: unknown }).startedAt;
  const startedAt = startedAtValue ? new Date(startedAtValue as Date) : null;

  const userId = options.userId ?? resolveId(ticket.user);
  const stationId = options.stationId ?? resolveId(ticket.station);
  const ticketVehicleId = resolveId(ticket.vehicle);

  const [stationInfo, vehicleInfo] = await Promise.all([
    fetchStationSnapshot(stationId),
    ticketVehicleId
      ? fetchVehicleSnapshot(ticketVehicleId)
      : fetchActiveVehicleSnapshot(userId),
  ]);

  const hydratedVehicleInfo = await refreshVehicleBatterySnapshot(vehicleInfo);
  const durationMs = resolveChargingDurationMsFromSnapshot(
    ticketSnapshot,
    hydratedVehicleInfo
  );

  ticketSnapshot = {
    ...ticketSnapshot,
    chargingDurationMs: durationMs,
  };

  ticketSnapshot = appendChargingEstimate(ticketSnapshot, startedAt, durationMs);

  ticketSnapshot = appendChargingBatteryPercentage(
    ticketSnapshot,
    typeof ticketSnapshot.progressPercent === "number"
      ? ticketSnapshot.progressPercent
      : null,
    hydratedVehicleInfo
  );

  return {
    ...ticketSnapshot,
    stationInfo,
    vehicleInfo: hydratedVehicleInfo,
  };
};

export { buildChargingTicketPayload };
