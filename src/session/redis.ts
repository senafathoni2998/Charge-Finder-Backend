import { createClient } from "redis";

// Support password via REDIS_URL: redis://[:password@]host:port
// Or via separate REDIS_PASSWORD variable
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisPassword = process.env.REDIS_PASSWORD;

const redisClient = createClient({
  url: redisUrl,
  password: redisPassword,
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
