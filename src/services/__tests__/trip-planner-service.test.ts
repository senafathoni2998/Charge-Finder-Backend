import {
  planTrip,
  deriveRangeKm,
  type PlanStation,
  type PlanParams,
} from "../trip-planner-service";

// Fixtures live on the equator so distance ≈ 111.19 km per degree of longitude.
const st = (
  id: string,
  lng: number,
  opts: { lat?: number; type?: string; powerKW?: number } = {}
): PlanStation => ({
  id,
  name: `S-${id}`,
  address: "addr",
  lat: opts.lat ?? 0,
  lng,
  connectors: [{ type: opts.type ?? "CCS2", powerKW: opts.powerKW ?? 100 }],
});

const baseParams = (over: Partial<PlanParams> = {}): PlanParams => ({
  origin: { lat: 0, lng: 0 },
  destination: { lat: 0, lng: 9 },
  fullRangeKm: 300,
  startBatteryPercent: 100,
  bufferPercent: 10,
  chargeToPercent: 80,
  allowedConnectorTypes: [],
  minPowerKW: 0,
  maxDetourKm: 25,
  ...over,
});

describe("deriveRangeKm", () => {
  it("derives km from usable capacity and consumption", () => {
    expect(deriveRangeKm(60, 18)).toBeCloseTo(333.33, 1); // 60 kWh / 18 per 100km
  });
  it("returns null for unusable inputs", () => {
    expect(deriveRangeKm(0, 18)).toBeNull();
    expect(deriveRangeKm(60, 0)).toBeNull();
    expect(deriveRangeKm(-5, 18)).toBeNull();
    expect(deriveRangeKm(NaN, 18)).toBeNull();
  });
});

describe("planTrip — trivial + direct", () => {
  it("is feasible with no stops for a same-point trip", () => {
    const plan = planTrip(
      baseParams({ destination: { lat: 0, lng: 0 } }),
      []
    );
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(0);
    expect(plan.directDistanceKm).toBe(0);
  });

  it("is feasible with no stops when the destination is within range", () => {
    const plan = planTrip(baseParams({ destination: { lat: 0, lng: 1 } }), []);
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(0);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].to.label).toBe("destination");
  });
});

describe("planTrip — multi-stop routing", () => {
  const chain = [
    st("a", 2.0),
    st("b", 3.5),
    st("c", 5.0),
    st("d", 6.5),
    st("e", 8.0),
  ];

  it("chains reachable stops to a distant destination", () => {
    const plan = planTrip(baseParams(), chain);
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(5);
    expect(plan.stops.map((s) => s.station.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(plan.legs).toHaveLength(6); // 5 stops + final leg
    // Every stop departs at the charge target and arrives with a sane battery %.
    for (const stop of plan.stops) {
      expect(stop.departBatteryPercent).toBe(80);
      expect(stop.arrivalBatteryPercent).toBeGreaterThan(0);
      expect(stop.arrivalBatteryPercent).toBeLessThanOrEqual(100);
    }
  });

  it("prefers the farthest reachable station that makes progress", () => {
    const plan = planTrip(
      baseParams({ destination: { lat: 0, lng: 3 } }),
      [st("near", 2.0), st("far", 2.4)]
    );
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(1);
    expect(plan.stops[0].station.id).toBe("far");
  });

  it("backtracks past a dead-end greedy pick to find a feasible route", () => {
    // fullRange 400 -> usableStart 360 km, perStop 280 km (buffer 10, chargeTo 80).
    // Destination ~700 km east; wide corridor so a laterally-offset station qualifies.
    const params = baseParams({
      fullRangeKm: 400,
      maxDetourKm: 200,
      destination: { lat: 0, lng: 6.3 },
    });
    // X is the greedy pick (closest to the destination, reachable from origin at ~348 km)
    // but DEAD-ENDS: from X, Z is ~281 km (> perStop 280) and the destination is ~419 km.
    // Y is nearer/less-progress, but O→Y→Z→dest chains (266.9, 278.0, 155.7 km — all in range).
    const stations = [
      st("X", 2.8, { lat: 1.4 }),
      st("Y", 2.4),
      st("Z", 4.9),
    ];
    const plan = planTrip(params, stations);
    expect(plan.feasible).toBe(true);
    // A pure-greedy planner would commit to X and report infeasible; backtracking finds Y→Z.
    expect(plan.stops.map((s) => s.station.id)).toEqual(["Y", "Z"]);
  });

  it("pins per-leg battery percentages", () => {
    const plan = planTrip(
      baseParams({ destination: { lat: 0, lng: 3 } }),
      [st("a", 2.0)]
    );
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(1);
    // origin→lng2 ≈ 222.4 km on a 300 km range from 100% → ~25.9%
    expect(plan.stops[0].arrivalBatteryPercent).toBeCloseTo(25.9, 1);
    expect(plan.stops[0].departBatteryPercent).toBe(80);
    // stop→dest ≈ 111.2 km from 80% → ~42.9%
    const finalLeg = plan.legs[plan.legs.length - 1];
    expect(finalLeg.arrivalBatteryPercent).toBeCloseTo(42.9, 1);
  });
});

describe("planTrip — station filters (single-stop reachable so feasibility flips)", () => {
  // Destination lng 3 (~333 km) needs exactly one stop; a single station at lng 2 makes
  // the trip feasible IFF it passes the filter — so these tests fail if the guard is removed.
  const nearDest = { destination: { lat: 0, lng: 3 } };

  it("excludes an incompatible connector type (and accepts a compatible one)", () => {
    expect(
      planTrip(baseParams({ ...nearDest, allowedConnectorTypes: ["CCS2"] }), [
        st("a", 2.0, { type: "Type2" }),
      ]).feasible
    ).toBe(false);
    expect(
      planTrip(baseParams({ ...nearDest, allowedConnectorTypes: ["CCS2"] }), [
        st("a", 2.0, { type: "CCS2" }),
      ]).feasible
    ).toBe(true);
  });

  it("excludes stations below the minimum power (and accepts sufficient power)", () => {
    expect(
      planTrip(baseParams({ ...nearDest, minPowerKW: 50 }), [
        st("a", 2.0, { powerKW: 20 }),
      ]).feasible
    ).toBe(false);
    expect(
      planTrip(baseParams({ ...nearDest, minPowerKW: 50 }), [
        st("a", 2.0, { powerKW: 100 }),
      ]).feasible
    ).toBe(true);
  });

  it("excludes stations outside the corridor (and accepts on-corridor ones)", () => {
    expect(
      planTrip(baseParams({ ...nearDest, maxDetourKm: 25 }), [
        st("a", 2.0, { lat: 1 }), // ~111 km off the line
      ]).feasible
    ).toBe(false);
    expect(
      planTrip(baseParams({ ...nearDest, maxDetourKm: 25 }), [
        st("a", 2.0, { lat: 0 }),
      ]).feasible
    ).toBe(true);
  });
});

describe("planTrip — infeasibility", () => {
  it("fails with a 'no feasible route' reason when no station qualifies", () => {
    const plan = planTrip(baseParams(), []);
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/no feasible route/i);
  });

  it("fails when starting charge does not clear the reserve", () => {
    const plan = planTrip(
      baseParams({ startBatteryPercent: 5, destination: { lat: 0, lng: 1 } }),
      []
    );
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/reserve buffer/i);
  });

  it("fails when the charge target cannot clear the reserve enough to progress", () => {
    const plan = planTrip(
      baseParams({ fullRangeKm: 100, bufferPercent: 10, chargeToPercent: 10.5 }),
      [st("a", 0.5)]
    );
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/charge target/i);
  });

  it("respects the maxStops guard (route needing more stops than allowed)", () => {
    const chain = [st("a", 2.0), st("b", 3.5), st("c", 5.0), st("d", 6.5), st("e", 8.0)];
    const plan = planTrip(baseParams({ maxStops: 2 }), chain);
    expect(plan.feasible).toBe(false);
  });

  it("treats a negative maxStops as zero (direct trips still feasible)", () => {
    const plan = planTrip(
      baseParams({ maxStops: -1, destination: { lat: 0, lng: 1 } }),
      []
    );
    expect(plan.feasible).toBe(true);
    expect(plan.totalStops).toBe(0);
  });
});
