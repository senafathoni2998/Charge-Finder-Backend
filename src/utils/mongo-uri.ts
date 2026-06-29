import { config } from "../config";

/**
 * Builds the MongoDB connection URI from validated config.
 *
 * - Honors an explicit MONGODB_URI override if present.
 * - URL-encodes the username and password so credentials containing special
 *   characters (@ : / ? # etc.) don't corrupt the URI.
 * - Includes the database name in the path (so we don't connect to `test`).
 * - Throws (fail-fast) if required config is missing.
 */
export const buildMongoUri = (): string => {
  if (config.db.uri) {
    return config.db.uri;
  }

  const { user, password, host, name } = config.db;
  if (!user || !password || !host || !name) {
    throw new Error(
      "Missing database configuration. Set DB_USER, DB_PASSWORD, DB_HOST and DB_NAME (or MONGODB_URI).",
    );
  }

  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}/${name}?retryWrites=true&w=majority&appName=ChargeFinder`;
};
