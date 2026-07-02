import {
  haversineKm,
  midpoint,
  pointToSegmentKm,
  isValidLatLng,
} from "../geo";

// ~111.19 km per degree along the equator.
const KM_PER_DEG = 111.19;

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBeCloseTo(0, 6);
  });

  it("measures ~111 km per degree of latitude", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      KM_PER_DEG,
      0
    );
  });

  it("measures ~111 km per degree of longitude at the equator", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      KM_PER_DEG,
      0
    );
  });

  it("is symmetric", () => {
    const a = { lat: -6.2, lng: 106.8 };
    const b = { lat: -6.9, lng: 107.6 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("midpoint", () => {
  it("returns the halfway point on a meridian", () => {
    const m = midpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 });
    expect(m.lat).toBeCloseTo(0, 4);
    expect(m.lng).toBeCloseTo(5, 4);
  });
});

describe("pointToSegmentKm", () => {
  const a = { lat: 0, lng: 0 };
  const b = { lat: 0, lng: 1 }; // segment along the equator

  it("is ~0 for a point on the segment", () => {
    expect(pointToSegmentKm({ lat: 0, lng: 0.5 }, a, b)).toBeCloseTo(0, 1);
  });

  it("measures perpendicular offset for a point beside the segment", () => {
    // 0.5° north of the mid-segment ≈ 55.6 km off the line.
    expect(pointToSegmentKm({ lat: 0.5, lng: 0.5 }, a, b)).toBeCloseTo(
      0.5 * KM_PER_DEG,
      0
    );
  });

  it("clamps to the endpoint for a point beyond the segment", () => {
    // 1° past the end (lng=2) → distance to endpoint b (lng=1) ≈ 111 km.
    expect(pointToSegmentKm({ lat: 0, lng: 2 }, a, b)).toBeCloseTo(KM_PER_DEG, 0);
  });

  it("returns distance to the point when the segment is degenerate", () => {
    expect(pointToSegmentKm({ lat: 0, lng: 1 }, a, a)).toBeCloseTo(KM_PER_DEG, 0);
  });
});

describe("isValidLatLng", () => {
  it("accepts valid coordinates", () => {
    expect(isValidLatLng({ lat: -6.2, lng: 106.8 })).toBe(true);
    expect(isValidLatLng({ lat: 90, lng: -180 })).toBe(true);
  });

  it("rejects out-of-range or non-numeric coordinates", () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidLatLng({ lat: "0", lng: 0 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng({ lat: NaN, lng: 0 })).toBe(false);
  });
});
