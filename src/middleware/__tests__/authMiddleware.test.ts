import { Request, Response, NextFunction } from "express";
import { authMiddleware, adminMiddleware } from "../authMiddleware";

// Use 'any' for mock types to avoid TypeScript strict type checking on test mocks
type MockRequest = {
  method: string;
  session?: any;
  headers: Record<string, string | undefined>;
  sessionID?: string;
  user?: any;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const buildReq = (overrides: Partial<MockRequest> = {}): MockRequest => ({
  method: "GET",
  session: {} as any,
  headers: {},
  sessionID: "test-session-id",
  ...overrides,
});

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe("authMiddleware", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("authMiddleware", () => {
    it("calls next and skips authentication for OPTIONS requests", () => {
      const req = buildReq({ method: "OPTIONS" });
      const res = buildRes();
      const next = jest.fn();

      authMiddleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 if session is not present", () => {
      const req = buildReq({
        method: "GET",
        session: undefined,
      });
      const res = buildRes();
      const next = jest.fn();

      authMiddleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 if session.user is not present", () => {
      const req = buildReq({
        method: "GET",
        session: {},
      });
      const res = buildRes();
      const next = jest.fn();

      authMiddleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    it("sets req.user and calls next if session.user is present", () => {
      const mockUser = {
        id: "user-123",
        username: "testuser",
        role: "user" as const,
      };
      const req = buildReq({
        method: "GET",
        session: { user: mockUser },
      });
      const res = buildRes();
      const next = jest.fn();

      authMiddleware(req as any, res as any, next);

      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    // NOTE: the previous "logs authentication check details" test was removed —
    // authMiddleware deliberately no longer logs the raw cookie/session (it leaked
    // valid session credentials into logs). See app.ts / Sprint 0 security fixes.
  });

  describe("adminMiddleware", () => {
    it("calls next and skips authentication for OPTIONS requests", () => {
      const req = buildReq({ method: "OPTIONS" });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 if no user found in req.user or session.user", () => {
      const req = buildReq({
        method: "GET",
        session: {},
        user: undefined,
      });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 if user role is not admin", () => {
      const mockUser = {
        id: "user-123",
        username: "regularuser",
        role: "user" as const,
      };
      const req = buildReq({
        method: "GET",
        user: mockUser,
      });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
      expect(next).not.toHaveBeenCalled();
    });

    it("sets req.user and calls next if user is admin", () => {
      const adminUser = {
        id: "admin-123",
        username: "adminuser",
        role: "admin" as const,
      };
      const req = buildReq({
        method: "GET",
        user: adminUser,
      });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(req.user).toEqual(adminUser);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("uses session.user if req.user is not set", () => {
      const adminUser = {
        id: "admin-456",
        username: "sessionadmin",
        role: "admin" as const,
      };
      const req = buildReq({
        method: "GET",
        session: { user: adminUser },
        user: undefined,
      });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(req.user).toEqual(adminUser);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("prefers req.user over session.user", () => {
      const reqUser = {
        id: "req-admin",
        username: "reqadmin",
        role: "admin" as const,
      };
      const sessionUser = {
        id: "session-admin",
        username: "sessionadmin",
        role: "admin" as const,
      };
      const req = buildReq({
        method: "GET",
        user: reqUser,
        session: { user: sessionUser },
      });
      const res = buildRes();
      const next = jest.fn();

      adminMiddleware(req as any, res as any, next);

      expect(req.user).toEqual(reqUser);
      expect(next).toHaveBeenCalled();
    });
  });
});
