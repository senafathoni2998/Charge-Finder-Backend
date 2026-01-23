export {};

import { toSnapshot, resolveId } from "../snapshot";

// Mock the models
jest.mock("../../../models/station", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}));

jest.mock("../../../models/vehicle", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));

describe("charging-ticket/snapshot", () => {
  describe("toSnapshot", () => {
    it("returns empty object for null", () => {
      expect(toSnapshot(null)).toEqual({});
    });

    it("returns empty object for undefined", () => {
      expect(toSnapshot(undefined)).toEqual({});
    });

    it("calls toObject if available", () => {
      const mockDoc = {
        id: "123",
        name: "Test",
        toObject: jest.fn().mockReturnValue({ id: "123", name: "Test" }),
      };

      const result = toSnapshot(mockDoc);

      expect(mockDoc.toObject).toHaveBeenCalledWith({ getters: true });
      expect(result).toEqual({ id: "123", name: "Test" });
    });

    it("spreads object if toObject not available", () => {
      const plainObject = { id: "123", name: "Test" };
      const result = toSnapshot(plainObject);

      expect(result).toEqual({ id: "123", name: "Test" });
    });

    it("creates a new object (not a reference)", () => {
      const original = { id: "123" };
      const result = toSnapshot(original);

      expect(result).not.toBe(original);
      expect(result).toEqual(original);
    });
  });

  describe("resolveId", () => {
    it("returns null for null", () => {
      expect(resolveId(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(resolveId(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(resolveId("")).toBeNull();
    });

    it("returns null for 0", () => {
      expect(resolveId(0)).toBeNull();
    });

    it("returns string as-is for string input", () => {
      expect(resolveId("abc123")).toBe("abc123");
    });

    it("returns id property if available on object", () => {
      expect(resolveId({ id: "obj-id-123" })).toBe("obj-id-123");
    });

    it("returns _id property as fallback", () => {
      expect(resolveId({ _id: "underscore-id-123" })).toBe("underscore-id-123");
    });

    it("prefers id over _id", () => {
      expect(resolveId({ id: "id-value", _id: "_id-value" })).toBe("id-value");
    });

    it("calls toString on _id if available", () => {
      const mockObjectId = {
        _id: {
          toString: jest.fn().mockReturnValue("objectid-123"),
        },
      };
      expect(resolveId(mockObjectId)).toBe("objectid-123");
    });

    it("calls toString on object as last resort", () => {
      const mockObject = {
        toString: jest.fn().mockReturnValue("string-repr"),
      };
      expect(resolveId(mockObject)).toBe("string-repr");
    });

    it("returns null if toString returns [object Object]", () => {
      const plainObject = {};
      expect(resolveId(plainObject)).toBeNull();
    });

    it("handles MongoDB ObjectId-like objects", () => {
      const mockObjectId = {
        _id: "abc123",
      };
      expect(resolveId(mockObjectId)).toBe("abc123");
    });

    it("handles nested _id with toString", () => {
      const nestedId = {
        _id: {
          toString: () => "nested-id-456",
        },
      };
      expect(resolveId(nestedId)).toBe("nested-id-456");
    });
  });
});
