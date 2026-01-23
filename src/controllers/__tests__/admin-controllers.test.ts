import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from "../admin-controllers";
import User from "../../models/user";
import Vehicle from "../../models/vehicle";
import ChargingTicket from "../../models/charging-ticket";
import HttpError from "../../models/http-error";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { deletePublicImageFile, getPublicImagePathFromFile } from "../../utils/image-paths";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
}));

jest.mock("mongoose", () => ({
  startSession: jest.fn(),
  Types: {
      ObjectId: jest.fn()
  }
}));

jest.mock("../../utils/image-paths", () => ({
  deletePublicImageFile: jest.fn(),
  getPublicImagePathFromFile: jest.fn(),
}));

jest.mock("../../models/user", () => {
    const UserMock = jest.fn() as jest.Mock & {
        find: jest.Mock;
        findOne: jest.Mock;
        findById: jest.Mock;
    };
    UserMock.find = jest.fn();
    UserMock.findOne = jest.fn();
    UserMock.findById = jest.fn();
    return { __esModule: true, default: UserMock };
});

jest.mock("../../models/vehicle", () => {
    const VehicleMock = jest.fn() as jest.Mock & {
        deleteMany: jest.Mock;
    };
    VehicleMock.deleteMany = jest.fn();
    return { __esModule: true, default: VehicleMock };
});

jest.mock("../../models/charging-ticket", () => {
    const ChargingMock = jest.fn() as jest.Mock & {
        deleteMany: jest.Mock;
    };
    ChargingMock.deleteMany = jest.fn();
    return { __esModule: true, default: ChargingMock };
});

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const UserMock = User as unknown as jest.Mock & {
  find: jest.Mock;
  findOne: jest.Mock;
  findById: jest.Mock;
};
const VehicleMock = Vehicle as unknown as jest.Mock & {
    deleteMany: jest.Mock;
};
const ChargingTicketMock = ChargingTicket as unknown as jest.Mock & {
    deleteMany: jest.Mock;
};

const validationResultMock = validationResult as unknown as jest.Mock;
const bcryptHashMock = bcrypt.hash as jest.Mock;
const startSessionMock = mongoose.startSession as jest.Mock;
const deleteImageMock = deletePublicImageFile as jest.Mock;
const getImagePathMock = getPublicImagePathFromFile as jest.Mock;

describe("admin-controllers", () => {
  beforeEach(() => {
    UserMock.find.mockReset();
    UserMock.findOne.mockReset();
    UserMock.findById.mockReset();
    VehicleMock.deleteMany.mockReset();
    ChargingTicketMock.deleteMany.mockReset();
    validationResultMock.mockReset();
    bcryptHashMock.mockReset();
    startSessionMock.mockReset();
    deleteImageMock.mockReset();
    getImagePathMock.mockReset();

    validationResultMock.mockReturnValue({ 
        isEmpty: () => true,
        array: () => [] 
    });
  });

  describe("getUsers", () => {
    it("returns 500 if database fetch fails", async () => {
        const req = {};
        const res = buildRes();
        const next = jest.fn();
        
        UserMock.find.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockRejectedValue(new Error("DB Error"))
            })
        });

        await getUsers(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(500);
    });

    it("returns users successfully without passwords", async () => {
        const req = {};
        const res = buildRes();
        const next = jest.fn();
        
        const mockUsers = [{ name: "User1" }, { name: "User2" }];
        UserMock.find.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockUsers)
            })
        });

        await getUsers(req as any, res as any, next);

        expect(UserMock.find).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ users: mockUsers });
    });
  });

  describe("createUser", () => {
    it("returns 422 if validation fails", async () => {
        validationResultMock.mockReturnValue({ 
            isEmpty: () => false,
            array: () => [{ msg: "Error" }] 
        });
        const req = { body: {} };
        const res = buildRes();
        const next = jest.fn();

        await createUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 500 if user check fails", async () => {
        const req = { body: { email: "test@test.com" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockRejectedValue(new Error("DB Error"));

        await createUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(500);
    });

    it("returns 422 if user already exists", async () => {
        const req = { body: { email: "test@test.com" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue({ id: "existing" });

        await createUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 500 if hashing fails", async () => {
        const req = { body: { email: "test@test.com", password: "pw" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);
        bcryptHashMock.mockRejectedValue(new Error("Hash Error"));

        await createUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(500);
    });

    it("creates user successfully", async () => {
        const req = { 
            body: { 
                name: "New", 
                email: "new@test.com", 
                password: "pw",
                role: "admin"
            } 
        };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);
        bcryptHashMock.mockResolvedValue("hashed_pw");

        const saveMock = jest.fn();
        const toObjectMock = jest.fn().mockReturnValue({ 
            name: "New", 
            email: "new@test.com", 
            role: "admin", 
            password: "hashed_pw" // Will be stripped
        });
        
        UserMock.mockImplementation(() => ({
            save: saveMock,
            toObject: toObjectMock
        }));

        await createUser(req as any, res as any, next);

        expect(bcryptHashMock).toHaveBeenCalledWith("pw", 12);
        expect(saveMock).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.not.objectContaining({ password: expect.anything() })
        }));
    });
  });

  describe("updateUser", () => {
    it("returns 422 if validation fails", async () => {
        validationResultMock.mockReturnValue({ 
            isEmpty: () => false,
            array: () => [{ msg: "Error" }] 
        });
        const req = { params: { userId: "u1" }, body: {} };
        const res = buildRes();
        const next = jest.fn();

        await updateUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 404 if user not found", async () => {
        const req = { params: { userId: "u1" }, body: {} };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue(null);

        await updateUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
    });

    it("returns 422 if new email already in use", async () => {
        const req = { params: { userId: "u1" }, body: { email: "new@test.com" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue({ email: "old@test.com" });
        UserMock.findOne.mockResolvedValue({ id: "other_user" });

        await updateUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("updates user successfully with new image and password", async () => {
        const req = { 
            params: { userId: "u1" }, 
            body: { 
                name: "Updated Name",
                email: "new@test.com",
                password: "new_pw",
                role: "admin"
            },
            file: { path: "new_image.jpg" }
        };
        const res = buildRes();
        const next = jest.fn();

        const mockUser = {
            email: "old@test.com",
            image: "old_image.jpg",
            save: jest.fn(),
            toObject: jest.fn().mockReturnValue({ name: "Updated Name" })
        };
        UserMock.findById.mockResolvedValue(mockUser);
        UserMock.findOne.mockResolvedValue(null); // Email check
        getImagePathMock.mockReturnValue("processed_new_image.jpg");
        bcryptHashMock.mockResolvedValue("new_hashed_pw");

        await updateUser(req as any, res as any, next);

        expect(mockUser.save).toHaveBeenCalled();
        expect(deleteImageMock).toHaveBeenCalledWith("old_image.jpg");
        // @ts-ignore
        expect(mockUser.password).toBe("new_hashed_pw");
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("deleteUser", () => {
    it("returns 404 if user not found", async () => {
        const req = { params: { userId: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue(null);

        await deleteUser(req as any, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
    });

    it("deletes user and associated data successfully", async () => {
        const req = { params: { userId: "u1" } };
        const res = buildRes();
        const next = jest.fn();

        const mockUser = {
            _id: "u1",
            image: "profile.jpg",
            deleteOne: jest.fn()
        };
        UserMock.findById.mockResolvedValue(mockUser);

        const mockSession = { 
            startTransaction: jest.fn(), 
            commitTransaction: jest.fn(),
            endSession: jest.fn() // Not called in code but good practice to mock
        };
        startSessionMock.mockResolvedValue(mockSession);
        VehicleMock.deleteMany.mockReturnValue({ session: jest.fn() });
        ChargingTicketMock.deleteMany.mockReturnValue({ session: jest.fn() });

        await deleteUser(req as any, res as any, next);

        expect(VehicleMock.deleteMany).toHaveBeenCalledWith({ owner: "u1" });
        expect(ChargingTicketMock.deleteMany).toHaveBeenCalledWith({ user: "u1" });
        expect(mockUser.deleteOne).toHaveBeenCalled();
        expect(deleteImageMock).toHaveBeenCalledWith("profile.jpg");
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
