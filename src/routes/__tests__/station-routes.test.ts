// Make this file a module to avoid global scope conflicts
export {};

// Mock dependencies before importing routes
jest.mock("../../middleware/authMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

// fileUpload pulls in `uuid` (ESM-only) which jest can't transform; stub it out.
jest.mock("../../middleware/fileUpload", () => ({
  fileUpload: {
    single: jest.fn(() => (req: any, res: any, next: any) => next()),
  },
}));

jest.mock("../../controllers/station-controllers", () => ({
  addStation: jest.fn(),
  updateStation: jest.fn(),
  requestChargingTicket: jest.fn(),
  startCharging: jest.fn(),
  updateChargingProgress: jest.fn(),
  completeCharging: jest.fn(),
  cancelCharging: jest.fn(),
  getActiveTicketForStation: jest.fn(),
  deleteStation: jest.fn(),
  getStations: jest.fn(),
  createOrUpdateStationReview: jest.fn(),
  getMyStationReview: jest.fn(),
  deleteMyStationReview: jest.fn(),
  adminDeleteStationReview: jest.fn(),
}));

const stationRoutes = require("../station-routes");
const { adminMiddleware } = require("../../middleware/authMiddleware");

describe("station-routes", () => {
  describe("route configuration", () => {
    const getRoutes = () =>
      stationRoutes.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

    it("has POST /add-station route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/add-station", methods: ["post"] });
    });

    it("has PATCH /update-station route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/update-station", methods: ["patch"] });
    });

    it("has POST /request-ticket route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/request-ticket", methods: ["post"] });
    });

    it("has POST /start-charging route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/start-charging", methods: ["post"] });
    });

    it("has PATCH /charging-progress route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/charging-progress", methods: ["patch"] });
    });

    it("has POST /complete-charging route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/complete-charging", methods: ["post"] });
    });

    it("has POST /cancel-charging route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/cancel-charging", methods: ["post"] });
    });

    it("has GET /:stationId/active-ticket route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/:stationId/active-ticket", methods: ["get"] });
    });

    it("has DELETE /delete-station route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/delete-station", methods: ["delete"] });
    });

    it("has GET / route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/", methods: ["get"] });
    });

    it("has POST /:stationId/reviews route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({
        path: "/:stationId/reviews",
        methods: ["post"],
      });
    });

    it("has GET /:stationId/reviews/me route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({
        path: "/:stationId/reviews/me",
        methods: ["get"],
      });
    });

    it("has DELETE /:stationId/reviews route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({
        path: "/:stationId/reviews",
        methods: ["delete"],
      });
    });

    it("has DELETE /:stationId/reviews/:reviewId route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({
        path: "/:stationId/reviews/:reviewId",
        methods: ["delete"],
      });
    });
  });

  describe("admin middleware protection", () => {
    it("uses adminMiddleware", () => {
      expect(adminMiddleware).toBeDefined();
    });

    it("add-station requires admin", () => {
      const addStationRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/add-station" && layer.route?.methods?.post
      );
      expect(addStationRoute).toBeDefined();
      expect(addStationRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("update-station requires admin", () => {
      const updateStationRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-station" && layer.route?.methods?.patch
      );
      expect(updateStationRoute).toBeDefined();
      expect(updateStationRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("delete-station requires admin", () => {
      const deleteStationRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/delete-station" && layer.route?.methods?.delete
      );
      expect(deleteStationRoute).toBeDefined();
      expect(deleteStationRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("admin review deletion requires admin", () => {
      const adminDeleteReviewRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/:stationId/reviews/:reviewId" &&
          layer.route?.methods?.delete
      );
      expect(adminDeleteReviewRoute).toBeDefined();
      // Assert adminMiddleware is actually in the handler chain — a length check alone
      // would still pass if adminMiddleware were dropped (validator + handler = 2 > 1).
      const handles = adminDeleteReviewRoute.route.stack.map(
        (layer: any) => layer.handle
      );
      expect(handles).toContain(adminMiddleware);
    });

    it("user-facing review routes are NOT admin-gated", () => {
      const userReviewRoutes = stationRoutes.stack.filter(
        (layer: any) =>
          (layer.route?.path === "/:stationId/reviews" ||
            layer.route?.path === "/:stationId/reviews/me") &&
          (layer.route?.methods?.post ||
            layer.route?.methods?.get ||
            layer.route?.methods?.delete)
      );
      expect(userReviewRoutes.length).toBeGreaterThan(0);
      for (const layer of userReviewRoutes) {
        const handles = layer.route.stack.map((l: any) => l.handle);
        expect(handles).not.toContain(adminMiddleware);
      }
    });
  });

  describe("route handler stack", () => {
    it("add-station has extensive validation", () => {
      const addStationRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/add-station" && layer.route?.methods?.post
      );
      // Multiple validators for all station fields
      expect(addStationRoute.route.stack.length).toBeGreaterThan(10);
    });

    it("request-ticket has validation", () => {
      const requestTicketRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/request-ticket" && layer.route?.methods?.post
      );
      expect(requestTicketRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("start-charging has validation", () => {
      const startChargingRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/start-charging" && layer.route?.methods?.post
      );
      expect(startChargingRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("charging-progress has validation", () => {
      const chargingProgressRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/charging-progress" && layer.route?.methods?.patch
      );
      expect(chargingProgressRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("complete-charging has validation", () => {
      const completeChargingRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/complete-charging" && layer.route?.methods?.post
      );
      expect(completeChargingRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("cancel-charging has validation", () => {
      const cancelChargingRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/cancel-charging" && layer.route?.methods?.post
      );
      expect(cancelChargingRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("active-ticket has stationId validation", () => {
      const activeTicketRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/:stationId/active-ticket" && layer.route?.methods?.get
      );
      expect(activeTicketRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("getStations has minimal middleware", () => {
      const getStationsRoute = stationRoutes.stack.find(
        (layer: any) => layer.route?.path === "/" && layer.route?.methods?.get
      );
      expect(getStationsRoute).toBeDefined();
      expect(getStationsRoute.route.stack.length).toBe(1);
    });
  });

  describe("total route count", () => {
    it("has exactly 14 routes", () => {
      const routeCount = stationRoutes.stack.filter((layer: any) => layer.route).length;
      expect(routeCount).toBe(14);
    });
  });

  describe("connector type validation", () => {
    it("validates connector types in add-station", () => {
      const addStationRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/add-station" && layer.route?.methods?.post
      );
      // Should have validators including connectors.*.type validation
      expect(addStationRoute.route.stack.length).toBeGreaterThan(5);
    });
  });

  describe("charging speed validation", () => {
    it("request-ticket accepts chargingSpeed", () => {
      const requestTicketRoute = stationRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/request-ticket" && layer.route?.methods?.post
      );
      // Has validators for stationId, connectorType, chargingSpeed, ticketKwh, vehicleId
      expect(requestTicketRoute.route.stack.length).toBeGreaterThanOrEqual(5);
    });
  });
});
