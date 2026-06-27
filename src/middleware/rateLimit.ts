import type { Request, Response, NextFunction } from "express";

import redisClient from "../session/redis";
import { config } from "../config";

const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;

type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
};

const resolveClientKey = (req: Request) => {
  const userId = req.user?.id ?? req.session?.user?.id;
  if (userId) {
    return `user:${userId}`;
  }

  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip;

  return `ip:${ip || "unknown"}`;
};

const resolveRouteKey = (req: Request) => {
  const basePath = req.baseUrl ?? "";
  const path = req.path ?? "";
  return `${req.method}:${basePath}${path}`;
};

const resolveLimitValue = (value: number | undefined, fallback: number) => {
  return Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : fallback;
};

export const createRateLimitMiddleware = (options: RateLimitOptions = {}) => {
  const limitWindowMs = resolveLimitValue(
    options.windowMs,
    RATE_LIMIT_WINDOW_MS
  );
  const limitMax = resolveLimitValue(options.max, RATE_LIMIT_MAX);
  const keyPrefix = options.keyPrefix ? `rate:${options.keyPrefix}` : "rate";

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      return next();
    }

    if (!redisClient.isOpen) {
      return next();
    }

    const clientKey = resolveClientKey(req);
    const routeKey = resolveRouteKey(req);
    const redisKey = `${keyPrefix}:${clientKey}:${routeKey}`;

    try {
      const currentCount = await redisClient.incr(redisKey);
      if (currentCount === 1) {
        await redisClient.pExpire(redisKey, limitWindowMs);
      }

      const remaining = Math.max(0, limitMax - currentCount);
      res.setHeader("X-RateLimit-Limit", limitMax.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());

      if (currentCount > limitMax) {
        const ttlMs = await redisClient.pTtl(redisKey);
        const ttlMsValue = typeof ttlMs === "number" ? ttlMs : null;
        if (ttlMsValue && ttlMsValue > 0) {
          res.setHeader(
            "Retry-After",
            Math.ceil(ttlMsValue / 1000).toString()
          );
          res.setHeader(
            "X-RateLimit-Reset",
            Math.ceil((Date.now() + ttlMsValue) / 1000).toString()
          );
        }

        return res
          .status(429)
          .json({ message: "Too many requests, please slow down." });
      }
    } catch (error) {
      console.warn("Rate limiter skipped due to error:", error);
    }

    return next();
  };
};

export const rateLimitMiddleware = createRateLimitMiddleware();
