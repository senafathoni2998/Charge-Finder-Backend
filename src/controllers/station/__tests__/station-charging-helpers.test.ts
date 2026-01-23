import {
  isChargingSpeedSupported,
  resolveChargingSpeed,
} from "../station-charging-helpers";

describe("station-charging-helpers", () => {
  describe("resolveChargingSpeed", () => {
    it("returns a known charging speed when valid", () => {
      expect(resolveChargingSpeed("NORMAL")).toBe("NORMAL");
      expect(resolveChargingSpeed("FAST")).toBe("FAST");
      expect(resolveChargingSpeed("ULTRA_FAST")).toBe("ULTRA_FAST");
    });

    it("falls back to NORMAL for invalid inputs", () => {
      expect(resolveChargingSpeed("SLOW")).toBe("NORMAL");
      expect(resolveChargingSpeed(123)).toBe("NORMAL");
      expect(resolveChargingSpeed(null)).toBe("NORMAL");
      expect(resolveChargingSpeed(undefined)).toBe("NORMAL");
    });
  });

  describe("isChargingSpeedSupported", () => {
    const station = {
      connectors: [
        { type: "CCS2", powerKW: 40 },
        { type: "CCS2", powerKW: 120 },
        { type: "Type2", powerKW: 22 },
      ],
    };

    it("returns true when any connector meets the required minimum power", () => {
      expect(isChargingSpeedSupported(station, "NORMAL")).toBe(true);
      expect(isChargingSpeedSupported(station, "FAST")).toBe(true);
      expect(isChargingSpeedSupported(station, "ULTRA_FAST")).toBe(true);
    });

    it("respects the connector type filter when provided", () => {
      expect(isChargingSpeedSupported(station, "FAST", "Type2")).toBe(false);
      expect(isChargingSpeedSupported(station, "FAST", "CCS2")).toBe(true);
      expect(isChargingSpeedSupported(station, "ULTRA_FAST", "CCS2")).toBe(
        true
      );
    });

    it("returns false when no connectors meet the minimum power", () => {
      const lowPowerStation = {
        connectors: [{ type: "CCS2", powerKW: 30 }],
      };

      expect(isChargingSpeedSupported(lowPowerStation, "FAST")).toBe(false);
    });

    it("returns false when connectors are missing or invalid", () => {
      expect(isChargingSpeedSupported({}, "FAST")).toBe(false);
      expect(
        isChargingSpeedSupported({ connectors: [{ type: "CCS2" }] }, "FAST")
      ).toBe(false);
    });
  });
});
