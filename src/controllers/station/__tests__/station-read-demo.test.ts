import { getStations } from "../station-read";
import Station from "../../../models/station";

// Demo-station seeding is gated behind config.enableDemoData — force it on here.
jest.mock("../../../config", () => ({ config: { enableDemoData: true } }));

jest.mock("express-validator", () => ({
  validationResult: jest.fn(() => ({ isEmpty: () => true })),
}));

jest.mock("../../../services/station-cache", () => ({
  getCachedJson: jest.fn(async () => null),
  setCachedJson: jest.fn(async () => undefined),
  stationByIdKey: jest.fn(),
  stationGeoKey: jest.fn(() => "geo-key"),
}));

jest.mock("../../../models/charging-ticket", () => {
  const M = jest.fn() as jest.Mock & { find: jest.Mock; findOne: jest.Mock };
  M.find = jest.fn(() => Promise.resolve([]));
  M.findOne = jest.fn();
  return { __esModule: true, default: M };
});

jest.mock("../../../models/station", () => {
  const M = jest.fn() as jest.Mock & {
    aggregate: jest.Mock;
    insertMany: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
  };
  M.aggregate = jest.fn();
  M.insertMany = jest.fn();
  M.find = jest.fn();
  M.findById = jest.fn();
  return {
    __esModule: true,
    default: M,
    toGeoPoint: (lat: number, lng: number) => ({
      type: "Point",
      coordinates: [lng, lat],
    }),
  };
});

const StationMock = Station as unknown as jest.Mock & {
  aggregate: jest.Mock;
  insertMany: jest.Mock;
};

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe("getStations demo-station seeding (enableDemoData)", () => {
  beforeEach(() => {
    StationMock.aggregate.mockReset();
    StationMock.insertMany.mockReset();
    StationMock.insertMany.mockResolvedValue(undefined);
  });

  it("seeds one station per status for a first-time user with nothing nearby", async () => {
    const demoDocs = [
      { _id: "d1", name: "A", status: "AVAILABLE", distanceMeters: 100 },
      { _id: "d2", name: "B", status: "BUSY", distanceMeters: 200 },
      { _id: "d3", name: "C", status: "OFFLINE", distanceMeters: 300 },
    ];
    StationMock.aggregate
      .mockResolvedValueOnce([]) // first query: nothing nearby
      .mockResolvedValueOnce(demoDocs); // re-query after seeding

    const req = { query: { lat: "10", lng: "20" } };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    expect(StationMock.insertMany).toHaveBeenCalledTimes(1);
    const seeded = StationMock.insertMany.mock.calls[0][0] as Array<{
      status: string;
      location: unknown;
    }>;
    expect(seeded).toHaveLength(3);
    expect(seeded.map((s) => s.status)).toEqual([
      "AVAILABLE",
      "BUSY",
      "OFFLINE",
    ]);
    expect(seeded[0].location).toEqual(
      expect.objectContaining({ type: "Point" }),
    );
    // Re-queried after seeding so the demo stations come back with distances.
    expect(StationMock.aggregate).toHaveBeenCalledTimes(2);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("does not seed when the user already has stations nearby", async () => {
    StationMock.aggregate.mockResolvedValueOnce([
      { _id: "s1", name: "Existing", distanceMeters: 50 },
    ]);

    const req = { query: { lat: "10", lng: "20" } };
    const res = buildRes();
    const next = jest.fn();

    await getStations(req as any, res as any, next);

    expect(StationMock.insertMany).not.toHaveBeenCalled();
    expect(StationMock.aggregate).toHaveBeenCalledTimes(1);
  });
});
