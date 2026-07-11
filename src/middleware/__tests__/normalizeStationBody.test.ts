import type { Request, Response } from "express";
import { normalizeStationBody } from "../normalizeStationBody";

const run = (body: unknown) => {
  const req = { body } as Request;
  const next = jest.fn();
  normalizeStationBody(req, {} as Response, next);
  return { req, next };
};

describe("normalizeStationBody", () => {
  it("parses JSON-encoded structured fields from multipart text fields", () => {
    const { req, next } = run({
      connectors: JSON.stringify([
        { type: "CCS2", powerKW: 50, ports: 2, availablePorts: 1 },
      ]),
      pricing: JSON.stringify({ currency: "IDR", perKwh: 2700 }),
      amenities: JSON.stringify(["Restroom", "Wi-Fi"]),
      photos: JSON.stringify([{ label: "Bay", gradient: "linear-gradient(...)" }]),
    });

    expect(req.body.connectors).toEqual([
      { type: "CCS2", powerKW: 50, ports: 2, availablePorts: 1 },
    ]);
    expect(req.body.pricing).toEqual({ currency: "IDR", perKwh: 2700 });
    expect(req.body.amenities).toEqual(["Restroom", "Wi-Fi"]);
    expect(req.body.photos).toEqual([
      { label: "Bay", gradient: "linear-gradient(...)" },
    ]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("coerces numeric lat/lng strings to numbers", () => {
    const { req } = run({ lat: "-6.2", lng: "106.8167" });
    expect(req.body.lat).toBe(-6.2);
    expect(req.body.lng).toBe(106.8167);
  });

  it("coerces removeFeaturedImage string to boolean", () => {
    expect(run({ removeFeaturedImage: "true" }).req.body.removeFeaturedImage).toBe(
      true
    );
    expect(run({ removeFeaturedImage: "false" }).req.body.removeFeaturedImage).toBe(
      false
    );
  });

  it("is a no-op for an already-parsed JSON body", () => {
    const body = {
      connectors: [{ type: "CCS2", powerKW: 50, ports: 2, availablePorts: 1 }],
      pricing: { currency: "IDR", perKwh: 2700 },
      amenities: ["Restroom"],
      lat: -6.2,
      lng: 106.8167,
    };
    const { req } = run({ ...body });
    expect(req.body).toEqual(body);
  });

  it("leaves an unparseable structured field untouched (validator will reject it)", () => {
    const { req, next } = run({ connectors: "not-json" });
    expect(req.body.connectors).toBe("not-json");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not throw on a missing/invalid body", () => {
    expect(() => run(undefined)).not.toThrow();
    expect(() => run(null)).not.toThrow();
  });
});
