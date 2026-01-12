import StationModel from "../models/station";
import { MOCK_STATIONS } from "./data/stations";

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
    ).map(({ id: _id, ...station }) => station);

    if (stationsToInsert.length === 0) {
      console.log("Stations already seeded");
      return;
    }

    await StationModel.insertMany(stationsToInsert, { ordered: false });
    console.log(`Seeded ${stationsToInsert.length} stations`);
  } catch (err) {
    console.error("Failed to seed stations:", err);
  }
}
