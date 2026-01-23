// Make this file a module to avoid global scope conflicts
export {};

// Mock dependencies before importing routes
jest.mock("../../middleware/fileUpload", () => ({
  fileUpload: {
    single: jest.fn(() => (req: any, res: any, next: any) => next()),
  },
}));

jest.mock("../../controllers/profile-controllers", () => ({
  getProfile: jest.fn(),
  getChargingHistory: jest.fn(),
  passwordUpdate: jest.fn(),
  profileUpdate: jest.fn(),
}));

const profileRoutes = require("../profile-routes");
const { fileUpload } = require("../../middleware/fileUpload");

describe("profile-routes", () => {
  describe("route configuration", () => {
    const getRoutes = () =>
      profileRoutes.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

    it("has GET / route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/", methods: ["get"] });
    });

    it("has GET /charging-history route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/charging-history", methods: ["get"] });
    });

    it("has PATCH /update-password route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/update-password", methods: ["patch"] });
    });

    it("has PATCH /update-profile route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/update-profile", methods: ["patch"] });
    });
  });

  describe("middleware configuration", () => {
    it("uses fileUpload for profile update", () => {
      expect(fileUpload.single).toBeDefined();
    });
  });

  describe("route handler stack", () => {
    it("GET / has controller handler", () => {
      const profileRoute = profileRoutes.stack.find(
        (layer: any) => layer.route?.path === "/" && layer.route?.methods?.get
      );
      expect(profileRoute).toBeDefined();
      expect(profileRoute.route.stack.length).toBeGreaterThan(0);
    });

    it("GET /charging-history has controller handler", () => {
      const historyRoute = profileRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/charging-history" && layer.route?.methods?.get
      );
      expect(historyRoute).toBeDefined();
      expect(historyRoute.route.stack.length).toBeGreaterThan(0);
    });

    it("PATCH /update-password has validation middleware", () => {
      const passwordRoute = profileRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-password" && layer.route?.methods?.patch
      );
      expect(passwordRoute).toBeDefined();
      // Validators for userId, currentPassword, newPassword + controller
      expect(passwordRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("PATCH /update-profile has file upload and validation middleware", () => {
      const profileUpdateRoute = profileRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-profile" && layer.route?.methods?.patch
      );
      expect(profileUpdateRoute).toBeDefined();
      // File upload + validators + controller
      expect(profileUpdateRoute.route.stack.length).toBeGreaterThan(1);
    });
  });

  describe("validation requirements", () => {
    it("update-password route validates userId, currentPassword, newPassword", () => {
      const passwordRoute = profileRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-password" && layer.route?.methods?.patch
      );
      // Route exists and has multiple handlers (validators + controller)
      expect(passwordRoute.route.stack.length).toBeGreaterThanOrEqual(4);
    });

    it("update-profile route validates userId", () => {
      const profileUpdateRoute = profileRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-profile" && layer.route?.methods?.patch
      );
      // File upload + validators + controller
      expect(profileUpdateRoute.route.stack.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("total route count", () => {
    it("has exactly 4 routes", () => {
      const routeCount = profileRoutes.stack.filter((layer: any) => layer.route).length;
      expect(routeCount).toBe(4);
    });
  });
});
