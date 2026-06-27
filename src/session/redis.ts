import { createClient } from "redis";

import { config } from "../config";
import { logger } from "../logger";

const redisClient = createClient({
  url: config.redis.url,
  password: config.redis.password,
});

redisClient.on("error", (err) => {
  logger.error({ err }, "Redis error");
});

export async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info("Redis connected");
  }
}

export default redisClient;
