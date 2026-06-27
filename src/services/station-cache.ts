import redisClient from "../session/redis";

/**
 * Lightweight Redis cache for station reads. All operations no-op gracefully when
 * Redis is unavailable (mirrors the rate limiter), so the app — and the tests —
 * keep working without a Redis connection.
 *
 * Station availability (availablePorts) changes during charging, so TTLs are kept
 * short; admin mutations also invalidate the per-id cache explicitly.
 */
const STATION_BY_ID_PREFIX = "station:byid:";
const STATION_GEO_PREFIX = "station:geo:";
const DEFAULT_TTL_SECONDS = 30;

const isReady = () => redisClient.isOpen;

export const getCachedJson = async <T>(key: string): Promise<T | null> => {
  if (!isReady()) return null;
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const setCachedJson = async (
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> => {
  if (!isReady()) return;
  try {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // ignore cache write failures
  }
};

export const stationByIdKey = (id: string): string =>
  `${STATION_BY_ID_PREFIX}${id}`;

// Quantize coordinates (~100m) so nearby requests share a cache entry.
export const stationGeoKey = (
  lat: number,
  lng: number,
  radiusKm: number | null,
  limit: number,
): string => {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return `${STATION_GEO_PREFIX}${q(lat)}:${q(lng)}:${radiusKm ?? "all"}:${limit}`;
};

export const invalidateStation = async (id: string): Promise<void> => {
  if (!isReady() || !id) return;
  try {
    await redisClient.del(stationByIdKey(id));
    // Geo-query caches expire via their short TTL (flushing by pattern is avoided
    // to keep invalidation O(1) on the hot admin path).
  } catch {
    // ignore
  }
};
