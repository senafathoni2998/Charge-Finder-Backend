import {
  getProfile,
  passwordUpdate,
  profileUpdate,
  getChargingHistory,
} from "../profile-controllers";
import User from "../../models/user";
import HttpError from "../../models/http-error";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import { fetchChargingHistoryForUser } from "../../services/charging-history-service";
import { deletePublicImageFile, getPublicImagePathFromFile } from "../../utils/image-paths";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock("../../services/charging-history-service", () => ({
  fetchChargingHistoryForUser: jest.fn(),
}));

jest.mock("../../utils/image-paths", () => ({
  deletePublicImageFile: jest.fn(),
  getPublicImagePathFromFile: jest.fn(),
}));

jest.mock("../../models/user", () => {
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

const UserMock = User as unknown as jest.Mock & {
  findById: jest.Mock;
};

const validationResultMock = validationResult as unknown as jest.Mock;
const bcryptHashMock = bcrypt.hash as jest.Mock;
const bcryptCompareMock = bcrypt.compare as jest.Mock;
const fetchHistoryMock = fetchChargingHistoryForUser as jest.Mock;
const deleteImageMock = deletePublicImageFile as jest.Mock;
const getImagePathMock = getPublicImagePathFromFile as jest.Mock;

describe("profile-controllers", () => {
  let req: any;

  beforeEach(() => {
    UserMock.findById.mockReset();
    validationResultMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptCompareMock.mockReset();
    fetchHistoryMock.mockReset();
    deleteImageMock.mockReset();
    getImagePathMock.mockReset();

    validationResultMock.mockReturnValue({ 
        isEmpty: () => true,
        array: () => [] 
    });

    req = {
        body: {},
        session: {
            user: { id: "u1" }
        }
    };
  });

  describe("getProfile", () => {
    it("returns 401 if user not authenticated", async () => {
        req.session.user = null;
        const res = buildRes();
        const next = jest.fn();

        await getProfile(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(401);
    });

    it("returns 500 if DB error occurs", async () => {
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockReturnValue({
            select: jest.fn().mockRejectedValue(new Error("DB Error"))
        });

        await getProfile(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(500);
    });

    it("returns 404 if user not found", async () => {
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue(null)
        });

        await getProfile(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
    });

    it("returns 200 with user data", async () => {
        const res = buildRes();
        const next = jest.fn();

        const mockUser = { id: "u1", name: "Test" };
        UserMock.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue(mockUser)
        });

        await getProfile(req, res as any, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ user: mockUser });
    });
  });

  describe("passwordUpdate", () => {
    it("returns 422 if validation fails", async () => {
        validationResultMock.mockReturnValue({ 
            isEmpty: () => false,
            array: () => [{ msg: "Error" }] 
        });
        const res = buildRes();
        const next = jest.fn();

        await passwordUpdate(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 404 if user not found", async () => {
        req.body = { userId: "u1", currentPassword: "pw", newPassword: "new" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue(null);

        await passwordUpdate(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
    });

    it("returns 401 if current password incorrect", async () => {
        req.body = { userId: "u1", currentPassword: "pw", newPassword: "new" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue({ password: "hashed" });
        bcryptCompareMock.mockResolvedValue(false);

        await passwordUpdate(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(401);
    });

    it("returns 200 and updates password on success", async () => {
        req.body = { userId: "u1", currentPassword: "pw", newPassword: "new" };
        const res = buildRes();
        const next = jest.fn();

        const mockUser = { 
            password: "hashed", 
            save: jest.fn() 
        };
        UserMock.findById.mockResolvedValue(mockUser);
        bcryptCompareMock.mockResolvedValue(true);
        bcryptHashMock.mockResolvedValue("new_hashed");

        await passwordUpdate(req, res as any, next);

        expect(mockUser.password).toBe("new_hashed");
        expect(mockUser.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("profileUpdate", () => {
    it("returns 422 if validation fails", async () => {
        validationResultMock.mockReturnValue({ 
            isEmpty: () => false,
            array: () => [{ msg: "Error" }] 
        });
        const res = buildRes();
        const next = jest.fn();

        await profileUpdate(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 404 if user not found", async () => {
        req.body = { userId: "u1" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findById.mockResolvedValue(null);

        await profileUpdate(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(404);
    });

    it("updates profile with new image and name", async () => {
         req.body = { userId: "u1", name: "New Name" };
         req.file = { path: "new.jpg" };
         const res = buildRes();
         const next = jest.fn();

         const mockUser = {
             name: "Old Name",
             image: "old.jpg",
             save: jest.fn()
         };
         UserMock.findById.mockResolvedValue(mockUser);
         getImagePathMock.mockReturnValue("processed_new.jpg");

         await profileUpdate(req, res as any, next);

         expect(mockUser.name).toBe("New Name");
         expect(mockUser.image).toBe("processed_new.jpg");
         expect(deleteImageMock).toHaveBeenCalledWith("old.jpg");
         expect(mockUser.save).toHaveBeenCalled();
         expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getChargingHistory", () => {
      it("returns 401 if not authenticated", async () => {
          req.session.user = null;
          const res = buildRes();
          const next = jest.fn();

          await getChargingHistory(req, res as any, next);

          expect(next).toHaveBeenCalledWith(expect.any(HttpError));
          expect(next.mock.calls[0][0].code).toBe(401);
      });

      it("returns 200 with history", async () => {
          const res = buildRes();
          const next = jest.fn();

          const mockHistory = [{ id: 1 }, { id: 2 }];
          fetchHistoryMock.mockResolvedValue(mockHistory);

          await getChargingHistory(req, res as any, next);

          expect(fetchHistoryMock).toHaveBeenCalledWith("u1", expect.any(Date));
          expect(res.status).toHaveBeenCalledWith(200);
          expect(res.json).toHaveBeenCalledWith({ history: mockHistory });
      });
  });
});
