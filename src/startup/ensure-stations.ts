import StationModel from "../models/station";
import { MOCK_STATIONS } from "./data/stations";
import { logger } from "../logger";

type StationSeed = (typeof MOCK_STATIONS)[number];

function stationKey(station: Pick<StationSeed, "name" | "address">) {
  return `${station.name}|${station.address}`;
}

export async function ensureStationsSeeded() {
  try {
    const existingStations = await StationModel.find(
      {},
      { name: 1, address: 1 }
    ).lean();

    const existingKeys = new Set(
      existingStations.map((station) => stationKey(station))
    );

    const stationsToInsert = MOCK_STATIONS.filter(
      (station) => !existingKeys.has(stationKey(station))
    ).map(({ id: _id, ...station }) => ({
      ...station,
      // insertMany bypasses the pre('validate') hook, so set the GeoJSON point here.
      location: {
        type: "Point" as const,
        coordinates: [station.lng, station.lat] as [number, number],
      },
    }));

    if (stationsToInsert.length === 0) {
      logger.info("Stations already seeded");
      return;
    }

    await StationModel.insertMany(stationsToInsert, { ordered: false });
    logger.info(`Seeded ${stationsToInsert.length} stations`);
  } catch (err) {
    logger.error({ err }, "Failed to seed stations");
  }
}
