import { createClient } from "redis";

import { config } from "../config";

const redisClient = createClient({
  url: config.redis.url,
  password: config.redis.password,
});

redisClient.on("error", (err) => {
  console.error("Redis error", err);
});

export async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("✅ Redis connected");
  }
}

export default redisClient;
