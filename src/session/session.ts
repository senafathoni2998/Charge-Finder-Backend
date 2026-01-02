import session from "express-session";
import redisClient from "./redis";

// ✅ correct import for connect-redis v7
const RedisStore = require("connect-redis").default;

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not defined");
}

const sessionMiddleware = session({
  name: "sid",
  store: new RedisStore({
    client: redisClient,
    prefix: "sess:",
  }),
  secret: process.env.SESSION_SECRET as string,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  },
});

export default sessionMiddleware;
