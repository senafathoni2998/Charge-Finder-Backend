import {
  addNewVehicle,
  updateVehicle,
  setActiveVehicle,
  deleteVehicle,
} from "../vehicle-mutations";
import Vehicle from "../../../models/vehicle";
import User from "../../../models/user";
import HttpError from "../../../models/http-error";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("mongoose", () => ({
  startSession: jest.fn(),
  Types: {
      ObjectId: jest.fn()
  }
}));

jest.mock("../../../models/vehicle", () => {
    const VehicleMock = jest.fn() as jest.Mock & {
        countDocuments: jest.Mock;
        findById: jest.Mock;
        updateMany: jest.Mock;
    };
    VehicleMock.countDocuments = jest.fn();
    VehicleMock.findById = jest.fn();
    VehicleMock.updateMany = jest.fn();
    return { __esModule: true, default: VehicleMock };
});

jest.mock("../../../models/user", () => {
    const UserMock = jest.fn() as jest.Mock & {
        findById: jest.Mock;
    };
    UserMock.findById = jest.fn();
    return { __esModule: true, default: UserMock };
});

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const VehicleMock = Vehicle as unknown as jest.Mock & {
  countDocuments: jest.Mock;
  findById: jest.Mock;
  updateMany: jest.Mock;
};
const UserMock = User as unknown as jest.Mock & {
    findById: jest.Mock;
};
const validationResultMock = validationResult as unknown as jest.Mock;
const startSessionMock = mongoose.startSession as jest.Mock;

describe("vehicle-mutations controllers", () => {
  beforeEach(() => {
    VehicleMock.mockClear();
    VehicleMock.countDocuments.mockReset();
    VehicleMock.findById.mockReset();
    VehicleMock.updateMany.mockReset();
    UserMock.findById.mockReset();
    validationResultMock.mockReset();
    startSessionMock.mockReset();

    validationResultMock.mockReturnValue({ 
        isEmpty: () => true,
        array: () => [] 
    });
  });

  describe("addNewVehicle", () => {
      it("returns 422 if validation fails", async () => {
          validationResultMock.mockReturnValue({ 
              isEmpty: () => false,
              array: () => [{ msg: "Error" }] 
          });
          const req = { body: {} };
          const res = buildRes();
          const next = jest.fn();

          await addNewVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(422);
      });

      it("returns 500 if user lookup fails", async () => {
          const req = { body: { userId: "u1" } };
          const res = buildRes();
          const next = jest.fn();
          UserMock.findById.mockRejectedValue(new Error("DB Error"));

          await addNewVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(500);
      });

      it("returns 422 if user does not exist", async () => {
          const req = { body: { userId: "u1" } };
          const res = buildRes();
          const next = jest.fn();
          UserMock.findById.mockResolvedValue(null);

          await addNewVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(422);
      });

      it("returns 422 if max vehicles limit reached", async () => {
        const req = { body: { userId: "u1" } };
        const res = buildRes();
        const next = jest.fn();
        UserMock.findById.mockResolvedValue({ _id: "u1" });
        VehicleMock.countDocuments.mockResolvedValue(3);

        await addNewVehicle(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
        expect(next.mock.calls[0][0].message).toContain("Vehicle limit reached");
      });

      it("creates vehicle successfully", async () => {
        const req = { 
            body: { 
                name: "Tesla", 
                connector_type: ["Type 2"], 
                min_power: 11, 
                userId: "u1",
                batteryCapacity: 75 
            } 
        };
        const res = buildRes();
        const next = jest.fn();

        const mockUser = { _id: "u1", vehicles: { push: jest.fn() }, save: jest.fn() };
        UserMock.findById.mockResolvedValue(mockUser);
        VehicleMock.countDocuments.mockResolvedValue(0);

        const mockSession = { 
            startTransaction: jest.fn(), 
            commitTransaction: jest.fn(),
            abortTransaction: jest.fn(),
            endSession: jest.fn()
        };
        startSessionMock.mockResolvedValue(mockSession);

        // Mock Vehicle constructor instance
        const saveMock = jest.fn();
        VehicleMock.mockImplementation(() => ({
            _id: "new_vehicle_id",
            batteryCapacity: 0,
            save: saveMock
        }));

        await addNewVehicle(req as any, res as any, next);

        expect(saveMock).toHaveBeenCalled();
        expect(mockUser.vehicles.push).toHaveBeenCalledWith("new_vehicle_id");
        expect(mockUser.save).toHaveBeenCalled();
        expect(mockSession.commitTransaction).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
      });
  });

  describe("updateVehicle", () => {
      it("returns 401 if not authenticated", async () => {
          const req = { body: {}, user: undefined };
          const res = buildRes();
          const next = jest.fn();

          await updateVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(401);
      });

      it("returns 403 if trying to update another user's vehicle", async () => {
          const req = { body: { userId: "u2" }, user: { id: "u1" } };
          const res = buildRes();
          const next = jest.fn();

          await updateVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(403);
      });

      it("returns 404 if vehicle not found", async () => {
          const req = { body: { vehicleId: "v1" }, user: { id: "u1" } };
          const res = buildRes();
          const next = jest.fn();
          
          VehicleMock.findById.mockResolvedValue(null);

          await updateVehicle(req as any, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(404);
      });

      it("returns 403 if user is not owner of vehicle", async () => {
        const req = { body: { vehicleId: "v1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();
        
        VehicleMock.findById.mockResolvedValue({ owner: "u2" });

        await updateVehicle(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(403);
      });

      it("updates vehicle successfully", async () => {
        const req = { 
            body: { 
                vehicleId: "v1", 
                name: "Updated Tesla",
                userId: "u1" 
            }, 
            user: { id: "u1" } 
        };
        const res = buildRes();
        const next = jest.fn();
        
        const mockVehicle = { 
            owner: "u1", 
            name: "Tesla", 
            save: jest.fn(),
            toObject: jest.fn().mockReturnValue({ name: "Updated Tesla" }) 
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);

        await updateVehicle(req as any, res as any, next);

        expect(mockVehicle.name).toBe("Updated Tesla");
        expect(mockVehicle.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });
  });

  describe("setActiveVehicle", () => {
      it("returns 200 and activates vehicle", async () => {
        const req = { 
            body: { vehicleId: "v1", active: true, userId: "u1" }, 
            user: { id: "u1" } 
        };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicle = { 
            _id: "v1",
            owner: "u1", 
            active: false,
            lastBatteryUpdatedAt: null,
            save: jest.fn(),
            toObject: jest.fn()
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);
        
        const mockSession = { 
            startTransaction: jest.fn(), 
            commitTransaction: jest.fn(),
            abortTransaction: jest.fn(),
            endSession: jest.fn()
        };
        startSessionMock.mockResolvedValue(mockSession);

        await setActiveVehicle(req as any, res as any, next);

        expect(VehicleMock.updateMany).toHaveBeenCalledWith(
            { owner: "u1", _id: { $ne: "v1" }, active: true },
            { $set: { active: false } },
            { session: mockSession }
        );
        expect(mockVehicle.active).toBe(true);
        expect(mockVehicle.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it("returns 200 and deactivates vehicle", async () => {
        const req = { 
            body: { vehicleId: "v1", active: false, userId: "u1" }, 
            user: { id: "u1" } 
        };
        const res = buildRes();
        const next = jest.fn();

        const mockVehicle = { 
            _id: "v1",
            owner: "u1", 
            active: true,
            save: jest.fn(),
            toObject: jest.fn()
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);

        await setActiveVehicle(req as any, res as any, next);

        expect(mockVehicle.active).toBe(false);
        expect(mockVehicle.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });
  });

  describe("deleteVehicle", () => {
    it("returns 404 if user not found during deletion", async () => {
        const req = { body: { vehicleId: "v1", userId: "u1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();
        
        VehicleMock.findById.mockResolvedValue({ _id: "v1", owner: "u1" });
        UserMock.findById.mockResolvedValue(null);

        await deleteVehicle(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
        expect(next.mock.calls[0][0].message).toBe("User not found.");
    });

    it("deletes vehicle successfully", async () => {
        const req = { body: { vehicleId: "v1", userId: "u1" }, user: { id: "u1" } };
        const res = buildRes();
        const next = jest.fn();
        
        const mockVehicle = { 
            _id: "v1", 
            owner: "u1", 
            deleteOne: jest.fn() 
        };
        VehicleMock.findById.mockResolvedValue(mockVehicle);
        
        const mockUser = { 
            _id: "u1", 
            vehicles: ["v1", "v2"], 
            save: jest.fn() 
        };
        UserMock.findById.mockResolvedValue(mockUser);

        const mockSession = { 
            startTransaction: jest.fn(), 
            commitTransaction: jest.fn(),
            endSession: jest.fn()
        };
        startSessionMock.mockResolvedValue(mockSession);

        await deleteVehicle(req as any, res as any, next);

        expect(mockVehicle.deleteOne).toHaveBeenCalled();
        expect(mockUser.vehicles).toHaveLength(1); // v1 removed
        expect(mockUser.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
