export {};

import { ensureStationsSeeded } from "../ensure-stations";

// Mock Station model
jest.mock("../../models/station", () => {
  return {
    __esModule: true,
    default: {
      find: jest.fn(),
      insertMany: jest.fn(),
    },
  };
});

// Mock MOCK_STATIONS data
jest.mock("../data/stations", () => ({
  MOCK_STATIONS: [
    {
      id: "st-1",
      name: "Existing Station",
      address: "123 Main St",
      lat: 0,
      lng: 0,
      connectors: [],
    },
    {
      id: "st-2",
      name: "New Station",
      address: "456 Oak Ave",
      lat: 1,
      lng: 1,
      connectors: [],
    },
    {
      id: "st-3",
      name: "Another New Station",
      address: "789 Pine Rd",
      lat: 2,
      lng: 2,
      connectors: [],
    },
  ],
}));

const StationModel = require("../../models/station").default;

describe("startup/ensure-stations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("seeds stations that don't exist", async () => {
    // Return one existing station
    StationModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { name: "Existing Station", address: "123 Main St" },
      ]),
    });

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await ensureStationsSeeded();

    expect(StationModel.find).toHaveBeenCalledWith({}, { name: 1, address: 1 });
    
    // Should insert st-2 and st-3 (filtered out st-1 because it exists)
    expect(StationModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "New Station" }),
        expect.objectContaining({ name: "Another New Station" }),
      ]),
      { ordered: false }
    );
    
    // Assert correct number of insertions (2 out of 3 total mock stations)
    const insertedArgs = StationModel.insertMany.mock.calls[0][0];
    expect(insertedArgs).toHaveLength(2);
    expect(insertedArgs[0]).not.toHaveProperty("id"); // Checks if id property is removed as per implementation

    expect(consoleSpy).toHaveBeenCalledWith("Seeded 2 stations");

    consoleSpy.mockRestore();
  });

  it("does nothing if all stations already exist", async () => {
    // Return all stations as existing
    StationModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { name: "Existing Station", address: "123 Main St" },
        { name: "New Station", address: "456 Oak Ave" },
        { name: "Another New Station", address: "789 Pine Rd" },
      ]),
    });

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await ensureStationsSeeded();

    expect(StationModel.insertMany).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("Stations already seeded");

    consoleSpy.mockRestore();
  });

  it("handles db errors gracefully", async () => {
    const error = new Error("DB Connection Failed");
    StationModel.find.mockReturnValue({
      lean: jest.fn().mockRejectedValue(error),
    });

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await ensureStationsSeeded();

    expect(consoleSpy).toHaveBeenCalledWith("Failed to seed stations:", error);

    consoleSpy.mockRestore();
  });

  it("handles insertMany errors gracefully", async () => {
    StationModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    
    const error = new Error("Insert Failed");
    StationModel.insertMany.mockRejectedValue(error);

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await ensureStationsSeeded();

    expect(consoleSpy).toHaveBeenCalledWith("Failed to seed stations:", error);

    consoleSpy.mockRestore();
  });
});
