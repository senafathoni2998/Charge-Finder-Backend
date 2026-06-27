import { getVehicles, getVehicleById } from "../vehicle-read";
import Vehicle from "../../../models/vehicle";
import User from "../../../models/user";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";
import {
  refreshVehicleBatterySnapshot,
  refreshVehicleBatterySnapshots,
} from "../../../services/vehicle-battery-service";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("../../../models/vehicle", () => {
    const VehicleMock = jest.fn() as jest.Mock & {
        find: jest.Mock;
        findById: jest.Mock;
    };
    VehicleMock.find = jest.fn();
    VehicleMock.findById = jest.fn();
    return { __esModule: true, default: VehicleMock };
});

jest.mock("../../../models/user", () => {
    const UserMock = jest.fn() as jest.Mock & {
        findById: jest.Mock;
    };
    UserMock.findById = jest.fn();
    return { __esModule: true, default: UserMock };
});

jest.mock("../../../services/vehicle-battery-service", () => ({
  refreshVehicleBatterySnapshot: jest.fn(),
  refreshVehicleBatterySnapshots: jest.fn(),
}));

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const VehicleMock = Vehicle as unknown as jest.Mock & {
  find: jest.Mock;
  findById: jest.Mock;
};
const UserMock = User as unknown as jest.Mock & {
    findById: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const refreshSnapshotMock = refreshVehicleBatterySnapshot as jest.Mock;
const refreshSnapshotsMock = refreshVehicleBatterySnapshots as jest.Mock;

describe("vehicle-read controllers", () => {
  beforeEach(() => {
    VehicleMock.find.mockReset();
    VehicleMock.findById.mockReset();
    UserMock.findById.mockReset();
    validationResultMock.mockReset();
    refreshSnapshotMock.mockReset();
    refreshSnapshotsMock.mockReset();

    validationResultMock.mockReturnValue({ isEmpty: () => true });
  });

  describe("getVehicles", () => {
    it("returns 401 if authentication is missing", async () => {
        const req = { };
        const res = buildRes();
        const next = jest.fn();

        await getVehicles(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        const error = next.mock.calls[0][0] as HttpError;
        expect(error.code).toBe(401);
    });

    it("forwards DB errors to the error middleware", async () => {
        const req = { user: { id: "user-1" } };
        const res = buildRes();
        const next = jest.fn();

        const dbError = new Error("Database error");
        UserMock.findById.mockReturnValue({
            populate: jest.fn().mockRejectedValue(dbError)
        });

        await getVehicles(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(dbError);
    });

    it("returns 404 if no vehicles found for the user", async () => {
        const req = { user: { id: "user-1" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({ vehicles: [] })
        });

        await getVehicles(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        const error = next.mock.calls[0][0] as HttpError;
        expect(error.code).toBe(404);
    });

    it("returns vehicles with refreshed battery data on success", async () => {
        const req = { user: { id: "user-1" } };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicles = [
            { toObject: jest.fn().mockReturnValue({ id: "v1" }) },
            { toObject: jest.fn().mockReturnValue({ id: "v2" }) }
        ];

        UserMock.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({ vehicles: mockVehicles })
        });

        const refreshedVehicles = [{ id: "v1", battery: 80 }, { id: "v2", battery: 90 }];
        refreshSnapshotsMock.mockResolvedValue(refreshedVehicles);

        await getVehicles(req as any, res as any, next);

        expect(refreshSnapshotsMock).toHaveBeenCalledWith([{ id: "v1" }, { id: "v2" }]);
        expect(res.json).toHaveBeenCalledWith({ vehicles: refreshedVehicles });
    });
  });

  describe("getVehicleById", () => {
      it("returns 422 if validation fails", async () => {
          validationResultMock.mockReturnValue({ isEmpty: () => false });
          const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
          const res = buildRes();
          const next = jest.fn();

          await getVehicleById(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(422);
      });

      it("returns 401 if authentication is missing", async () => {
          const req = { params: { vehicleId: "v1" } };
          const res = buildRes();
          const next = jest.fn();

          await getVehicleById(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(401);
      });

      it("forwards DB errors to the error middleware", async () => {
        const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        const dbError = new Error("DB Error");
        VehicleMock.findById.mockRejectedValue(dbError);

        await getVehicleById(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(dbError);
      });

      it("returns 404 if vehicle not found", async () => {
        const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        VehicleMock.findById.mockResolvedValue(null);

        await getVehicleById(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
      });

      it("returns 403 if user is not the owner", async () => {
        const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicle = {
            owner: "other-user",
            toObject: jest.fn()
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);

        await getVehicleById(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(403);
      });

      it("returns vehicle with refreshed battery data on success", async () => {
        const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicleObj = { id: "v1", owner: "u1" };
        const mockVehicle = {
            owner: "u1",
            toObject: jest.fn().mockReturnValue(mockVehicleObj)
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);
        
        const refreshedVehicle = { ...mockVehicleObj, battery: 95 };
        refreshSnapshotMock.mockResolvedValue(refreshedVehicle);

        await getVehicleById(req as any, res as any, next);

        expect(refreshSnapshotMock).toHaveBeenCalledWith(mockVehicleObj);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ vehicle: refreshedVehicle });
      });

      it("returns original snapshot if refresh returns null", async () => {
        const req = { params: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicleObj = { id: "v1", owner: "u1" };
        const mockVehicle = {
            owner: "u1",
            toObject: jest.fn().mockReturnValue(mockVehicleObj)
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);
        
        refreshSnapshotMock.mockResolvedValue(null);

        await getVehicleById(req as any, res as any, next);

        expect(res.json).toHaveBeenCalledWith({ vehicle: mockVehicleObj });
      });
  });
});
