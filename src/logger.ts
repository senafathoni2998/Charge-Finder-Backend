import pino from "pino";

import { config } from "./config";

// Structured application logger. JSON in production; quiet in tests so unit-test
// output stays clean (tests that assert log calls mock this module instead).
export const logger = pino({
  level: config.isTest ? "silent" : config.isProduction ? "info" : "debug",
});
