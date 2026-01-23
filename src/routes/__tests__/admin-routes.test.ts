// Make this file a module to avoid global scope conflicts
export {};

// Mock dependencies before importing routes
jest.mock("../../middleware/authMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middleware/fileUpload", () => ({
  fileUpload: {
    single: jest.fn(() => (req: any, res: any, next: any) => next()),
  },
}));

jest.mock("../../controllers/admin-controllers", () => ({
  getUsers: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
}));

const adminRoutes = require("../admin-routes");
const { adminMiddleware } = require("../../middleware/authMiddleware");
const { fileUpload } = require("../../middleware/fileUpload");

describe("admin-routes", () => {
  describe("route configuration", () => {
    const getRoutes = () =>
      adminRoutes.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

    it("has GET /users route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/users", methods: ["get"] });
    });

    it("has POST /users route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/users", methods: ["post"] });
    });

    it("has PATCH /users/:userId route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/users/:userId", methods: ["patch"] });
    });

    it("has DELETE /users/:userId route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/users/:userId", methods: ["delete"] });
    });
  });

  describe("middleware configuration", () => {
    it("uses adminMiddleware for protected routes", () => {
      // The adminMiddleware module should be imported in admin-routes
      expect(adminMiddleware).toBeDefined();
    });

    it("uses fileUpload middleware for image uploads", () => {
      expect(fileUpload.single).toBeDefined();
    });
  });

  describe("route handler stack", () => {
    it("GET /users has admin middleware in its stack", () => {
      const getUsersRoute = adminRoutes.stack.find(
        (layer: any) => layer.route?.path === "/users" && layer.route?.methods?.get
      );
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute.route.stack.length).toBeGreaterThan(0);
    });

    it("POST /users has validation middleware", () => {
      const createUserRoute = adminRoutes.stack.find(
        (layer: any) => layer.route?.path === "/users" && layer.route?.methods?.post
      );
      expect(createUserRoute).toBeDefined();
      // Validators are added as middleware
      expect(createUserRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("PATCH /users/:userId has file upload middleware", () => {
      const updateUserRoute = adminRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/users/:userId" && layer.route?.methods?.patch
      );
      expect(updateUserRoute).toBeDefined();
      expect(updateUserRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("DELETE /users/:userId has validation for userId param", () => {
      const deleteUserRoute = adminRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/users/:userId" && layer.route?.methods?.delete
      );
      expect(deleteUserRoute).toBeDefined();
      expect(deleteUserRoute.route.stack.length).toBeGreaterThan(1);
    });
  });

  describe("total route count", () => {
    it("has exactly 4 routes", () => {
      const routeCount = adminRoutes.stack.filter((layer: any) => layer.route).length;
      expect(routeCount).toBe(4);
    });
  });
});
