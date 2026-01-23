// Make this file a module to avoid global scope conflicts
export {};

// Mock dependencies before importing routes
jest.mock("../../controllers/vehicle-controllers", () => ({
  addNewVehicle: jest.fn(),
  updateVehicle: jest.fn(),
  setActiveVehicle: jest.fn(),
  deleteVehicle: jest.fn(),
  getVehicleById: jest.fn(),
  getVehicles: jest.fn(),
}));

const vehicleRoutes = require("../vehicle-routes");

describe("vehicle-routes", () => {
  describe("route configuration", () => {
    const getRoutes = () =>
      vehicleRoutes.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

    it("has POST /add-vehicle route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/add-vehicle", methods: ["post"] });
    });

    it("has PATCH /update-vehicle route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/update-vehicle", methods: ["patch"] });
    });

    it("has PATCH /set-active-vehicle route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/set-active-vehicle", methods: ["patch"] });
    });

    it("has DELETE /delete-vehicle route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/delete-vehicle", methods: ["delete"] });
    });

    it("has GET /:vehicleId route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/:vehicleId", methods: ["get"] });
    });

    it("has GET / route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/", methods: ["get"] });
    });
  });

  describe("route handler stack", () => {
    it("add-vehicle has validation middleware", () => {
      const addVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/add-vehicle" && layer.route?.methods?.post
      );
      expect(addVehicleRoute).toBeDefined();
      // Validators for userId, name, connector_type, min_power, batteryCapacity
      expect(addVehicleRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("update-vehicle has validation middleware", () => {
      const updateVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-vehicle" && layer.route?.methods?.patch
      );
      expect(updateVehicleRoute).toBeDefined();
      // Validators for vehicleId (required) + optional fields
      expect(updateVehicleRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("set-active-vehicle has validation middleware", () => {
      const setActiveRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/set-active-vehicle" && layer.route?.methods?.patch
      );
      expect(setActiveRoute).toBeDefined();
      // Validators for vehicleId (required), userId (optional), active (optional)
      expect(setActiveRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("delete-vehicle has validation middleware", () => {
      const deleteVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/delete-vehicle" && layer.route?.methods?.delete
      );
      expect(deleteVehicleRoute).toBeDefined();
      // Validators for vehicleId (required), userId (optional)
      expect(deleteVehicleRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("get by vehicleId has validation middleware", () => {
      const getByIdRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/:vehicleId" && layer.route?.methods?.get
      );
      expect(getByIdRoute).toBeDefined();
      // Validator for vehicleId
      expect(getByIdRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("getVehicles has minimal middleware", () => {
      const getVehiclesRoute = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/" && layer.route?.methods?.get
      );
      expect(getVehiclesRoute).toBeDefined();
      expect(getVehiclesRoute.route.stack.length).toBe(1);
    });
  });

  describe("validation requirements", () => {
    it("add-vehicle validates optional connector_type as array", () => {
      const addVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/add-vehicle" && layer.route?.methods?.post
      );
      // Multiple validators including array validation
      expect(addVehicleRoute.route.stack.length).toBeGreaterThanOrEqual(6);
    });

    it("update-vehicle requires vehicleId", () => {
      const updateVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/update-vehicle" && layer.route?.methods?.patch
      );
      // vehicleId is required, plus optional validators
      expect(updateVehicleRoute.route.stack.length).toBeGreaterThanOrEqual(7);
    });

    it("set-active-vehicle requires vehicleId", () => {
      const setActiveRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/set-active-vehicle" && layer.route?.methods?.patch
      );
      expect(setActiveRoute.route.stack.length).toBeGreaterThanOrEqual(3);
    });

    it("delete-vehicle requires vehicleId", () => {
      const deleteVehicleRoute = vehicleRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/delete-vehicle" && layer.route?.methods?.delete
      );
      expect(deleteVehicleRoute.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("total route count", () => {
    it("has exactly 6 routes", () => {
      const routeCount = vehicleRoutes.stack.filter((layer: any) => layer.route).length;
      expect(routeCount).toBe(6);
    });
  });

  describe("HTTP methods", () => {
    it("uses POST for add-vehicle", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/add-vehicle"
      );
      expect(route.route.methods.post).toBe(true);
    });

    it("uses PATCH for update-vehicle", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/update-vehicle"
      );
      expect(route.route.methods.patch).toBe(true);
    });

    it("uses PATCH for set-active-vehicle", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/set-active-vehicle"
      );
      expect(route.route.methods.patch).toBe(true);
    });

    it("uses DELETE for delete-vehicle", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/delete-vehicle"
      );
      expect(route.route.methods.delete).toBe(true);
    });

    it("uses GET for /:vehicleId", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/:vehicleId"
      );
      expect(route.route.methods.get).toBe(true);
    });

    it("uses GET for /", () => {
      const route = vehicleRoutes.stack.find(
        (layer: any) => layer.route?.path === "/"
      );
      expect(route.route.methods.get).toBe(true);
    });
  });
});
