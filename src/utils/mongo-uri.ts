/**
 * Builds the MongoDB connection URI from environment variables.
 *
 * - Honors an explicit MONGODB_URI override if present.
 * - URL-encodes the username and password so credentials containing special
 *   characters (@ : / ? # etc.) don't corrupt the URI.
 * - Includes the database name in the path (so we don't connect to `test`).
 * - Throws (fail-fast) if required config is missing.
 */
export const buildMongoUri = (): string => {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;
  if (!DB_USER || !DB_PASSWORD || !DB_HOST || !DB_NAME) {
    throw new Error(
      "Missing database configuration. Set DB_USER, DB_PASSWORD, DB_HOST and DB_NAME (or MONGODB_URI).",
    );
  }

  const user = encodeURIComponent(DB_USER);
  const pass = encodeURIComponent(DB_PASSWORD);
  return `mongodb+srv://${user}:${pass}@${DB_HOST}/${DB_NAME}?retryWrites=true&w=majority&appName=ChargeFinder`;
};
