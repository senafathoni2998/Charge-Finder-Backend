type ChargingSpeed = "NORMAL" | "FAST" | "ULTRA_FAST";

const CHARGING_SPEED_MIN_POWER_KW: Record<ChargingSpeed, number> = {
  NORMAL: 0,
  FAST: 50,
  ULTRA_FAST: 120,
};

const resolveChargingSpeed = (value: unknown): ChargingSpeed => {
  if (value === "FAST" || value === "ULTRA_FAST" || value === "NORMAL") {
    return value;
  }

  return "NORMAL";
};

const isChargingSpeedSupported = (
  station: { connectors?: Array<{ type?: string; powerKW?: number }> },
  chargingSpeed: ChargingSpeed,
  connectorType?: string | null
) => {
  const minPower = CHARGING_SPEED_MIN_POWER_KW[chargingSpeed];
  const connectors = Array.isArray(station.connectors) ? station.connectors : [];
  const eligibleConnectors = connectorType
    ? connectors.filter((connector) => connector.type === connectorType)
    : connectors;

  return eligibleConnectors.some(
    (connector) =>
      typeof connector.powerKW === "number" && connector.powerKW >= minPower
  );
};

export type { ChargingSpeed };
export { resolveChargingSpeed, isChargingSpeedSupported };
