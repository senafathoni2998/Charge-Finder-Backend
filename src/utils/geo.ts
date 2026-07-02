// Small, dependency-free geo helpers for the trip planner. Distances are in km.
// The planner approximates a route as the great-circle path between two points and
// selects charging stations within a corridor of that path — there is no road-network
// routing engine, so these are straight-line/geodesic approximations, accurate enough
// for corridor selection and range budgeting at city/inter-city scale.

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export const isValidLatLng = (p: unknown): p is LatLng => {
  if (!p || typeof p !== "object") {
    return false;
  }
  const { lat, lng } = p as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

// Great-circle distance between two points, in km.
export const haversineKm = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Great-circle midpoint of two points (used to center the candidate-station query).
export const midpoint = (a: LatLng, b: LatLng): LatLng => {
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const bx = Math.cos(lat2) * Math.cos(dLng);
  const by = Math.cos(lat2) * Math.sin(dLng);
  const lat3 = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2)
  );
  const lng3 = lng1 + Math.atan2(by, Math.cos(lat1) + bx);

  return {
    lat: toDeg(lat3),
    // normalise longitude back into [-180, 180]
    lng: ((toDeg(lng3) + 540) % 360) - 180,
  };
};

// Local equirectangular projection of `p` onto a plane centred at `origin`, in km.
// Good for the short offsets involved in corridor math (tens of km).
const projectKm = (origin: LatLng, p: LatLng) => ({
  x:
    toRad(p.lng - origin.lng) *
    Math.cos(toRad((origin.lat + p.lat) / 2)) *
    EARTH_RADIUS_KM,
  y: toRad(p.lat - origin.lat) * EARTH_RADIUS_KM,
});

/**
 * Shortest distance (km) from point `p` to the segment `a`→`b` — i.e. how far `p` sits
 * off the direct route. Uses a local planar projection and clamps to the segment ends,
 * so a point "beyond" either endpoint measures to that endpoint.
 */
export const pointToSegmentKm = (p: LatLng, a: LatLng, b: LatLng): number => {
  const P = projectKm(a, p);
  const B = projectKm(a, b);
  const lenSq = B.x * B.x + B.y * B.y;
  if (lenSq === 0) {
    return haversineKm(p, a);
  }
  let t = (P.x * B.x + P.y * B.y) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = P.x - t * B.x;
  const dy = P.y - t * B.y;
  return Math.sqrt(dx * dx + dy * dy);
};
