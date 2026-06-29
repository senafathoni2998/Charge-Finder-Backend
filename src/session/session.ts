import session from "express-session";
import redisClient from "./redis";
import { config } from "../config";

// ✅ correct import for connect-redis v7
const RedisStore = require("connect-redis").default;

const sessionMiddleware = session({
  name: "sid",
  store: new RedisStore({
    client: redisClient,
    prefix: "sess:",
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: config.isProduction,
  cookie: {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  },
});

export default sessionMiddleware;
