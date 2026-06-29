import { z } from "zod";

// Centralized, validated application configuration. Imported (transitively) only
// AFTER dotenv.config() runs in app.ts / the backfill scripts, so process.env is
// already populated. Validation runs once at import and fails fast with an
// aggregated, readable error if required configuration is missing or malformed.

const isTest = process.env.NODE_ENV === "test";

// Unit tests don't have real secrets; supply harmless defaults so importing config
// (transitively, via many modules) never throws. Real dev/prod still fail fast.
const envSource: NodeJS.ProcessEnv = isTest
  ? {
      SECRET_KEY: "test-secret-key",
      SESSION_SECRET: "test-session-secret",
      ...process.env,
    }
  : process.env;

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback);

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: positiveInt(5000),

  // Required secrets — the app must never run with these unset.
  SECRET_KEY: z.string().min(1, "SECRET_KEY is required (JWT signing key)"),
  SESSION_SECRET: z
    .string()
    .min(1, "SESSION_SECRET is required (session signing key)"),

  // Database — either MONGODB_URI or the DB_* set is required at connect time
  // (enforced in utils/mongo-uri.ts so non-DB tooling can still import config).
  MONGODB_URI: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_NAME: z.string().optional(),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // CORS
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: positiveInt(60_000),
  RATE_LIMIT_MAX: positiveInt(60),
  SIGNUP_RATE_LIMIT_WINDOW_MS: positiveInt(3_600_000),
  SIGNUP_RATE_LIMIT_MAX: positiveInt(5),

  // Feature flags / misc
  DISABLE_SIGNUP: z.string().optional(),
  ENABLE_DEMO_DATA: z.string().optional(),
  BATTERY_CAPACITY_DEFAULT: z.string().optional(),
});

const parsed = envSchema.safeParse(envSource);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;
const asBool = (value: string | undefined) => value === "true";

export const config = {
  nodeEnv: env.NODE_ENV ?? "development",
  isProduction: env.NODE_ENV === "production",
  isTest,
  port: env.PORT,

  jwtSecret: env.SECRET_KEY,
  sessionSecret: env.SESSION_SECRET,

  db: {
    uri: env.MONGODB_URI,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    host: env.DB_HOST,
    name: env.DB_NAME,
  },

  redis: {
    url: env.REDIS_URL || "redis://localhost:6379",
    password: env.REDIS_PASSWORD,
  },

  // Origins from env (the app also allows localhost dev origins, added in app.ts).
  corsOrigins: [...(env.CORS_ORIGINS?.split(",") ?? []), env.CORS_ORIGIN ?? ""]
    .map((value) => value.trim())
    .filter(Boolean),

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    signupWindowMs: env.SIGNUP_RATE_LIMIT_WINDOW_MS,
    signupMax: env.SIGNUP_RATE_LIMIT_MAX,
  },

  disableSignup: asBool(env.DISABLE_SIGNUP),
  enableDemoData: asBool(env.ENABLE_DEMO_DATA),
  batteryCapacityDefault: env.BATTERY_CAPACITY_DEFAULT,
};

export type AppConfig = typeof config;
