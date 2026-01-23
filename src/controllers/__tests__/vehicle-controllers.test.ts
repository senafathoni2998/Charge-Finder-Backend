import * as VehicleControllers from "../vehicle-controllers";

describe("vehicle-controllers exports", () => {
  it("exports all expected functions", () => {
    expect(VehicleControllers).toEqual(
      expect.objectContaining({
        addNewVehicle: expect.any(Function),
        updateVehicle: expect.any(Function),
        setActiveVehicle: expect.any(Function),
        deleteVehicle: expect.any(Function),
        getVehicles: expect.any(Function),
        getVehicleById: expect.any(Function),
      })
    );
  });
});
