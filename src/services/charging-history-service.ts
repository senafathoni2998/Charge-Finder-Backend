import ChargingHistory from "../models/charging-history";

export type ChargingHistoryOutcome = "COMPLETED" | "CANCELLED";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const resolveId = (value: unknown): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof (value as { id?: unknown }).id === "string") {
      return (value as { id: string }).id;
    }

    if (typeof (value as { _id?: unknown })._id === "string") {
      return (value as { _id: string })._id;
    }

    if ((value as { _id?: { toString?: () => string } })._id?.toString) {
      return (value as { _id: { toString: () => string } })._id.toString();
    }

    if ((value as { toString?: () => string }).toString) {
      const stringified = (value as { toString: () => string }).toString();
      return stringified === "[object Object]" ? null : stringified;
    }
  }

  return null;
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

const normalizePercent = (value: unknown) => {
  if (typeof value !== "number") {
    return null;
  }

  return clampPercent(value);
};

const normalizeDurationMs = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
};

const parseDate = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const resolveConnectorType = (value: unknown) => {
  if (value === "CCS2" || value === "Type2" || value === "CHAdeMO") {
    return value;
  }

  return null;
};

const resolveSnapshotId = (
  snapshot: Record<string, unknown>,
  key: "station" | "vehicle"
) => {
  const direct = resolveId(snapshot[key]);
  if (direct) {
    return direct;
  }

  const infoKey = key === "station" ? "stationInfo" : "vehicleInfo";
  const info = (snapshot as { stationInfo?: unknown; vehicleInfo?: unknown })[
    infoKey
  ];

  if (!info) {
    return null;
  }

  return resolveId(info);
};

const resolveSnapshotInfo = (value: unknown) => {
  return isRecord(value) ? value : null;
};

export const recordChargingHistory = async ({
  userId,
  ticketSnapshot,
  outcome,
  endedAt,
}: {
  userId: string;
  ticketSnapshot: Record<string, unknown>;
  outcome: ChargingHistoryOutcome;
  endedAt: Date;
}) => {
  if (!userId || !ticketSnapshot || !outcome) {
    return null;
  }

  const stationInfo = resolveSnapshotInfo(
    (ticketSnapshot as { stationInfo?: unknown }).stationInfo
  );
  const vehicleInfo = resolveSnapshotInfo(
    (ticketSnapshot as { vehicleInfo?: unknown }).vehicleInfo
  );

  const ticketId = resolveId(ticketSnapshot);
  const stationId = resolveSnapshotId(ticketSnapshot, "station");
  const vehicleId = resolveSnapshotId(ticketSnapshot, "vehicle");

  const startedAt = parseDate(ticketSnapshot.startedAt);
  const endedAtDate = parseDate(endedAt) ?? new Date();

  if (!ticketId) {
    return null;
  }

  const historyEntry = new ChargingHistory({
    user: userId,
    ticketId,
    station: stationId ?? undefined,
    stationName: typeof stationInfo?.name === "string" ? stationInfo.name : undefined,
    stationAddress:
      typeof stationInfo?.address === "string" ? stationInfo.address : undefined,
    vehicle: vehicleId ?? undefined,
    vehicleName: typeof vehicleInfo?.name === "string" ? vehicleInfo.name : undefined,
    connectorType: resolveConnectorType(ticketSnapshot.connectorType),
    startedAt: startedAt ?? undefined,
    endedAt: endedAtDate,
    outcome,
    progressPercent: normalizePercent(ticketSnapshot.progressPercent) ?? undefined,
    startingBatteryPercent:
      normalizePercent(ticketSnapshot.startingBatteryPercent) ?? undefined,
    batteryPercentage:
      normalizePercent(ticketSnapshot.batteryPercentage) ?? undefined,
    chargingDurationMs:
      normalizeDurationMs(ticketSnapshot.chargingDurationMs) ?? undefined,
  });

  try {
    await historyEntry.save();
  } catch (err) {
    const error = err as { code?: number };
    if (error?.code === 11000) {
      return null;
    }
    throw err;
  }

  return historyEntry.toObject({ getters: true });
};

export const fetchChargingHistoryForUser = async (
  userId: string,
  since: Date
) => {
  if (!userId) {
    return [];
  }

  return ChargingHistory.find(
    { user: userId, endedAt: { $gte: since } },
    {
      __v: 0,
    }
  )
    .sort({ endedAt: -1 })
    .lean();
};
