import {
  signup,
  login,
  createAdmin,
  logout,
  getSession,
} from "../auth-controllers";
import User from "../../models/user";
import HttpError from "../../models/http-error";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
// @ts-ignore
import jwt from "jsonwebtoken";
import { getPublicImagePathFromFile } from "../../utils/image-paths";

jest.mock("express-validator", () => ({
  validationResult: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(),
}));

jest.mock("../../utils/image-paths", () => ({
  getPublicImagePathFromFile: jest.fn(),
}));

jest.mock("../../models/user", () => {
    const UserMock = jest.fn() as jest.Mock & {
        findOne: jest.Mock;
    };
    UserMock.findOne = jest.fn();
    return { __esModule: true, default: UserMock };
});

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  clearCookie: jest.Mock;
};

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  clearCookie: jest.fn(),
});

const UserMock = User as unknown as jest.Mock & {
  findOne: jest.Mock;
};

const validationResultMock = validationResult as unknown as jest.Mock;
const bcryptHashMock = bcrypt.hash as jest.Mock;
const bcryptCompareMock = bcrypt.compare as jest.Mock;
const jwtSignMock = jwt.sign as jest.Mock;
const getImagePathMock = getPublicImagePathFromFile as jest.Mock;

describe("auth-controllers", () => {
  let req: any;

  beforeEach(() => {
    UserMock.findOne.mockReset();
    validationResultMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptCompareMock.mockReset();
    jwtSignMock.mockReset();
    getImagePathMock.mockReset();

    validationResultMock.mockReturnValue({ 
        isEmpty: () => true,
        array: () => [] 
    });

    req = {
        body: {},
        session: {
            regenerate: jest.fn((cb) => cb(null)),
            destroy: jest.fn((cb) => cb(null)),
            save: jest.fn((cb) => cb(null)),
            user: null
        }
    };
  });

  describe("signup", () => {
    it("returns 422 if validation fails", async () => {
        validationResultMock.mockReturnValue({ 
            isEmpty: () => false,
            array: () => [{ msg: "Error" }] 
        });
        const res = buildRes();
        const next = jest.fn();

        await signup(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 422 if email already exists", async () => {
        req.body = { email: "test@test.com" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue({ id: "existing" });

        await signup(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(422);
    });

    it("returns 500 if hashing fails", async () => {
        req.body = { email: "test@test.com", password: "pw" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);
        bcryptHashMock.mockRejectedValue(new Error("Hash Error"));

        await signup(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(500);
    });

    it("creates user and session successfully", async () => {
        req.body = { 
            name: "New", 
            email: "new@test.com", 
            password: "pw"
        };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);
        bcryptHashMock.mockResolvedValue("hashed_pw");
        jwtSignMock.mockReturnValue("token");

        const saveMock = jest.fn();
        const toObjectMock = jest.fn().mockReturnValue({ 
            id: "u1",
            name: "New", 
            email: "new@test.com", 
            role: "user"
        });
        
        UserMock.mockImplementation(() => ({
            id: "u1",
            name: "New",
            email: "new@test.com",
            role: "user",
            save: saveMock,
            toObject: toObjectMock
        }));

        await signup(req, res as any, next);

        expect(saveMock).toHaveBeenCalled();
        expect(jwtSignMock).toHaveBeenCalled();
        expect(req.session.regenerate).toHaveBeenCalled();
        expect(req.session.user).toEqual(expect.objectContaining({ id: "u1" }));
        expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("login", () => {
    it("returns 401 if user not found", async () => {
        req.body = { email: "test@test.com", password: "pw" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);

        await login(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(401);
    });

    it("returns 401 if password invalid", async () => {
        req.body = { email: "test@test.com", password: "pw" };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue({ password: "hashed" });
        bcryptCompareMock.mockResolvedValue(false);

        await login(req, res as any, next);

        expect(next).toHaveBeenCalledWith(expect.any(HttpError));
        expect(next.mock.calls[0][0].code).toBe(401);
    });

    it("logs in successfully", async () => {
        req.body = { email: "test@test.com", password: "pw" };
        const res = buildRes();
        const next = jest.fn();

        const mockUser = {
            id: "u1",
            name: "User",
            email: "test@test.com",
            password: "hashed",
            role: "user",
            toObject: jest.fn().mockReturnValue({ id: "u1", name: "User" })
        };

        UserMock.findOne.mockResolvedValue(mockUser);
        bcryptCompareMock.mockResolvedValue(true);
        jwtSignMock.mockReturnValue("token");

        await login(req, res as any, next);

        expect(req.session.regenerate).toHaveBeenCalled();
        expect(req.session.user).toEqual(expect.objectContaining({ id: "u1" }));
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("createAdmin", () => {
    it("returns 201 on success", async () => {
         req.body = { 
            name: "Admin", 
            email: "admin@test.com", 
            password: "pw"
        };
        const res = buildRes();
        const next = jest.fn();

        UserMock.findOne.mockResolvedValue(null);
        bcryptHashMock.mockResolvedValue("hashed_pw");

        const saveMock = jest.fn();
        const toObjectMock = jest.fn().mockReturnValue({ 
            name: "Admin", 
            email: "admin@test.com"
        });
        
        UserMock.mockImplementation(() => ({
            save: saveMock,
            toObject: toObjectMock
        }));

        await createAdmin(req, res as any, next);

        expect(UserMock).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }));
        expect(saveMock).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("logout", () => {
      it("destroys session and clears cookie", async () => {
          const res = buildRes();
          const next = jest.fn();

          await logout(req, res as any, next);

          expect(req.session.destroy).toHaveBeenCalled();
          expect(res.clearCookie).toHaveBeenCalledWith("sid");
          expect(res.status).toHaveBeenCalledWith(200);
      });
  });

  describe("getSession", () => {
      it("returns session info", () => {
          req.session.user = { id: "u1" };
          req.sessionID = "sid123";
          const res = buildRes();

          getSession(req, res as any);

          expect(res.status).toHaveBeenCalledWith(200);
          expect(res.json).toHaveBeenCalledWith({
              sessionId: "sid123",
              user: { id: "u1" },
              isLoggedIn: true
          });
      });
  });
});
