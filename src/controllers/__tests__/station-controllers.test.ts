import * as StationControllers from "../station-controllers";

describe("station-controllers exports", () => {
  it("exports all expected functions", () => {
    expect(StationControllers).toEqual(
      expect.objectContaining({
        addStation: expect.any(Function),
        updateStation: expect.any(Function),
        deleteStation: expect.any(Function),
        requestChargingTicket: expect.any(Function),
        getActiveTicketForStation: expect.any(Function),
        startCharging: expect.any(Function),
        updateChargingProgress: expect.any(Function),
        completeCharging: expect.any(Function),
        cancelCharging: expect.any(Function),
        getStations: expect.any(Function),
        getStationById: expect.any(Function),
        listStationReviews: expect.any(Function),
        getMyStationReview: expect.any(Function),
        createOrUpdateStationReview: expect.any(Function),
        deleteMyStationReview: expect.any(Function),
        adminDeleteStationReview: expect.any(Function),
      })
    );
  });
});
