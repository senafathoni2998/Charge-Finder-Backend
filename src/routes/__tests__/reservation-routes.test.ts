export {};

jest.mock("../../middleware/authMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/reservation-controllers", () => ({
  createReservation: jest.fn(),
  getAvailability: jest.fn(),
  getMyReservations: jest.fn(),
  getStationReservations: jest.fn(),
  getReservationById: jest.fn(),
  cancelReservation: jest.fn(),
}));

const reservationRoutes = require("../reservation-routes");
const { adminMiddleware } = require("../../middleware/authMiddleware");

const routeLayers = () =>
  reservationRoutes.stack.filter((layer: any) => layer.route);

const getRoutes = () =>
  routeLayers().map((layer: any) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }));

describe("reservation-routes", () => {
  it("registers all reservation routes", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ path: "/", methods: ["post"] });
    expect(routes).toContainEqual({ path: "/", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/availability", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/station/:stationId", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/:reservationId", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/:reservationId", methods: ["delete"] });
  });

  it("has exactly 6 routes", () => {
    expect(routeLayers().length).toBe(6);
  });

  it("registers GET /availability before GET /:reservationId so the literal path wins", () => {
    const layers = routeLayers();
    const availabilityIdx = layers.findIndex(
      (l: any) => l.route.path === "/availability" && l.route.methods.get
    );
    const paramIdx = layers.findIndex(
      (l: any) => l.route.path === "/:reservationId" && l.route.methods.get
    );
    expect(availabilityIdx).toBeGreaterThanOrEqual(0);
    expect(paramIdx).toBeGreaterThanOrEqual(0);
    expect(availabilityIdx).toBeLessThan(paramIdx);
  });

  it("admin-gates GET /station/:stationId", () => {
    const layer = routeLayers().find(
      (l: any) => l.route.path === "/station/:stationId" && l.route.methods.get
    );
    expect(layer).toBeDefined();
    const handles = layer.route.stack.map((s: any) => s.handle);
    expect(handles).toContain(adminMiddleware);
  });

  it("does not admin-gate the user-facing routes", () => {
    const userLayers = routeLayers().filter((l: any) =>
      ["/", "/availability", "/:reservationId"].includes(l.route.path)
    );
    expect(userLayers.length).toBeGreaterThan(0);
    for (const layer of userLayers) {
      const handles = layer.route.stack.map((s: any) => s.handle);
      expect(handles).not.toContain(adminMiddleware);
    }
  });
});
