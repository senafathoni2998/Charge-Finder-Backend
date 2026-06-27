import { Request, Response, NextFunction } from "express";
import { createRateLimitMiddleware, rateLimitMiddleware } from "../rateLimit";

// Create mock functions for redis client
const mockIncr = jest.fn();
const mockPExpire = jest.fn();
const mockPTtl = jest.fn();

jest.mock("../../session/redis", () => ({
  __esModule: true,
  default: {
    isOpen: true,
    incr: (...args: any[]) => mockIncr(...args),
    pExpire: (...args: any[]) => mockPExpire(...args),
    pTtl: (...args: any[]) => mockPTtl(...args),
  },
}));

jest.mock("../../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const { logger } = require("../../logger");

// Access the mocked module to toggle isOpen
const getRedisClient = () => require("../../session/redis").default;

// Use 'any' for mock types to avoid TypeScript strict type checking on test mocks  
type MockRequest = {
  method: string;
  baseUrl?: string;
  path?: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: any;
  session?: any;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
};

const buildReq = (overrides: Partial<MockRequest> = {}): MockRequest => ({
  method: "GET",
  baseUrl: "/api",
  path: "/test",
  ip: "127.0.0.1",
  headers: {},
  ...overrides,
});

const buildRes = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  setHeader: jest.fn(),
});

describe("rateLimit middleware", () => {
  let consoleWarnSpy: jest.SpyInstance;
  let redisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient = getRedisClient();
    redisClient.isOpen = true;
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("createRateLimitMiddleware", () => {
    it("creates a middleware function", () => {
      const middleware = createRateLimitMiddleware();
      expect(typeof middleware).toBe("function");
    });

    it("skips rate limiting for OPTIONS requests", async () => {
      const middleware = createRateLimitMiddleware();
      const req = buildReq({ method: "OPTIONS" });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(mockIncr).not.toHaveBeenCalled();
    });

    it("skips rate limiting when redis is not open", async () => {
      redisClient.isOpen = false;
      const middleware = createRateLimitMiddleware();
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(mockIncr).not.toHaveBeenCalled();
    });

    it("increments counter and sets headers on first request", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware({ max: 100 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalled();
      expect(mockPExpire).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "99");
      expect(next).toHaveBeenCalled();
    });

    it("does not set pexpire on subsequent requests", async () => {
      mockIncr.mockResolvedValue(5);

      const middleware = createRateLimitMiddleware({ max: 100 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalled();
      expect(mockPExpire).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "95");
      expect(next).toHaveBeenCalled();
    });

    it("returns 429 when rate limit is exceeded", async () => {
      mockIncr.mockResolvedValue(101);
      mockPTtl.mockResolvedValue(30000);

      const middleware = createRateLimitMiddleware({ max: 100 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        message: "Too many requests, please slow down.",
      });
      expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "30");
      expect(next).not.toHaveBeenCalled();
    });

    it("sets proper headers when rate limit is exceeded with TTL", async () => {
      const mockTtl = 15000; // 15 seconds
      mockIncr.mockResolvedValue(61);
      mockPTtl.mockResolvedValue(mockTtl);

      const middleware = createRateLimitMiddleware({ max: 60 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      const mockNow = 1700000000000;
      jest.spyOn(Date, "now").mockReturnValue(mockNow);

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "15");
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Reset",
        Math.ceil((mockNow + mockTtl) / 1000).toString()
      );
      expect(res.status).toHaveBeenCalledWith(429);

      jest.spyOn(Date, "now").mockRestore();
    });

    it("uses user id for rate limit key when authenticated", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({ user: { id: "user-123", username: "testuser", role: "user" } });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("user:user-123")
      );
    });

    it("uses session user id when req.user is not set", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({ session: { user: { id: "session-user-456", username: "sessionuser", role: "user" } } });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("user:session-user-456")
      );
    });

    it("uses IP address for anonymous users", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({ ip: "192.168.1.100" });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("ip:192.168.1.100")
      );
    });

    it("uses x-forwarded-for header when available", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({
        headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
      });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("ip:10.0.0.1")
      );
    });

    it("includes route information in the redis key", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({
        method: "POST",
        baseUrl: "/api/v1",
        path: "/users",
      });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("POST:/api/v1/users")
      );
    });

    it("uses custom keyPrefix when provided", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware({ keyPrefix: "custom" });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("rate:custom:")
      );
    });

    it("handles redis errors gracefully", async () => {
      mockIncr.mockRejectedValue(new Error("Redis connection error"));

      const middleware = createRateLimitMiddleware();
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Rate limiter skipped due to error"
      );
      expect(next).toHaveBeenCalled();
    });

    it("uses custom windowMs option", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const customWindowMs = 120000; // 2 minutes
      const middleware = createRateLimitMiddleware({ windowMs: customWindowMs });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockPExpire).toHaveBeenCalledWith(
        expect.any(String),
        customWindowMs
      );
    });

    it("uses custom max option", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware({ max: 10 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "10");
      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "9");
    });

    it("handles zero remaining correctly", async () => {
      mockIncr.mockResolvedValue(60);

      const middleware = createRateLimitMiddleware({ max: 60 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
      expect(next).toHaveBeenCalled(); // Should still pass at exactly limit
    });

    it("handles unknown IP gracefully", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const middleware = createRateLimitMiddleware();
      const req = buildReq({ ip: undefined });
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalledWith(
        expect.stringContaining("ip:unknown")
      );
    });

    it("does not set Retry-After header when TTL is not positive", async () => {
      mockIncr.mockResolvedValue(101);
      mockPTtl.mockResolvedValue(-1);

      const middleware = createRateLimitMiddleware({ max: 100 });
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(429);
      // Should not call setHeader with Retry-After when TTL is -1
      const retryAfterCalls = res.setHeader.mock.calls.filter(
        (call: any[]) => call[0] === "Retry-After"
      );
      expect(retryAfterCalls.length).toBe(0);
    });
  });

  describe("rateLimitMiddleware (default instance)", () => {
    it("is a function", () => {
      expect(typeof rateLimitMiddleware).toBe("function");
    });

    it("uses default configuration", async () => {
      mockIncr.mockResolvedValue(1);
      mockPExpire.mockResolvedValue(true);

      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await rateLimitMiddleware(req as any, res as any, next);

      expect(mockIncr).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "60");
      expect(next).toHaveBeenCalled();
    });
  });
});
