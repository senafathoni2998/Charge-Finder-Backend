export {};

jest.mock("../../controllers/trip-controllers", () => ({
  planTripHandler: jest.fn(),
  saveTrip: jest.fn(),
  getMyTrips: jest.fn(),
  getTripById: jest.fn(),
  deleteTrip: jest.fn(),
}));

const tripRoutes = require("../trip-routes");

const routeLayers = () => tripRoutes.stack.filter((layer: any) => layer.route);
const getRoutes = () =>
  routeLayers().map((layer: any) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }));

describe("trip-routes", () => {
  it("registers all trip routes", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ path: "/plan", methods: ["post"] });
    expect(routes).toContainEqual({ path: "/", methods: ["post"] });
    expect(routes).toContainEqual({ path: "/", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/:tripId", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/:tripId", methods: ["delete"] });
  });

  it("has exactly 5 routes", () => {
    expect(routeLayers().length).toBe(5);
  });

  it("attaches the full validator chain to POST /plan", () => {
    const layer = routeLayers().find(
      (l: any) => l.route.path === "/plan" && l.route.methods.post
    );
    // 14 check() validators + 1 handler — exact so a dropped validator is caught.
    expect(layer.route.stack.length).toBe(15);
  });

  it("registers POST /plan and POST / as distinct routes", () => {
    const posts = getRoutes().filter((r: any) => r.methods.includes("post"));
    const paths = posts.map((r: any) => r.path).sort();
    expect(paths).toEqual(["/", "/plan"]);
  });
});
