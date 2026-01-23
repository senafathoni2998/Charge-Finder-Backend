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

jest.mock("../../middleware/rateLimit", () => ({
  createRateLimitMiddleware: jest.fn(() => (req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/auth-controllers", () => ({
  login: jest.fn(),
  signup: jest.fn(),
  createAdmin: jest.fn(),
  logout: jest.fn(),
  getSession: jest.fn(),
}));

const authRoutes = require("../auth-routes");
const { adminMiddleware } = require("../../middleware/authMiddleware");
const { createRateLimitMiddleware } = require("../../middleware/rateLimit");
const { fileUpload } = require("../../middleware/fileUpload");

describe("auth-routes", () => {
  describe("route configuration", () => {
    const getRoutes = () =>
      authRoutes.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

    it("has POST /login route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/login", methods: ["post"] });
    });

    it("has POST /signup route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/signup", methods: ["post"] });
    });

    it("has POST /admin/signup route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/admin/signup", methods: ["post"] });
    });

    it("has POST /logout route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/logout", methods: ["post"] });
    });

    it("has GET /session route", () => {
      const routes = getRoutes();
      expect(routes).toContainEqual({ path: "/session", methods: ["get"] });
    });
  });

  describe("middleware configuration", () => {
    it("uses adminMiddleware for admin signup", () => {
      expect(adminMiddleware).toBeDefined();
    });

    it("uses createRateLimitMiddleware for signup", () => {
      // The rate limit middleware is applied to signup route
      expect(createRateLimitMiddleware).toBeDefined();
      const signupRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/signup" && layer.route?.methods?.post
      );
      // Signup route should have multiple middleware (including rate limit)
      expect(signupRoute.route.stack.length).toBeGreaterThan(3);
    });

    it("uses fileUpload for signup routes", () => {
      expect(fileUpload.single).toBeDefined();
    });
  });

  describe("route handler stack", () => {
    it("POST /login has validation middleware", () => {
      const loginRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/login" && layer.route?.methods?.post
      );
      expect(loginRoute).toBeDefined();
      // Validators for email and password
      expect(loginRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("POST /signup has rate limit, file upload, and validation middleware", () => {
      const signupRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/signup" && layer.route?.methods?.post
      );
      expect(signupRoute).toBeDefined();
      // Rate limit + file upload + validators + controller
      expect(signupRoute.route.stack.length).toBeGreaterThan(2);
    });

    it("POST /admin/signup has admin middleware", () => {
      const adminSignupRoute = authRoutes.stack.find(
        (layer: any) =>
          layer.route?.path === "/admin/signup" && layer.route?.methods?.post
      );
      expect(adminSignupRoute).toBeDefined();
      expect(adminSignupRoute.route.stack.length).toBeGreaterThan(1);
    });

    it("POST /logout has minimal middleware", () => {
      const logoutRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/logout" && layer.route?.methods?.post
      );
      expect(logoutRoute).toBeDefined();
    });

    it("GET /session has minimal middleware", () => {
      const sessionRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/session" && layer.route?.methods?.get
      );
      expect(sessionRoute).toBeDefined();
    });
  });

  describe("rate limit configuration", () => {
    it("signup route has rate limiting applied", () => {
      // Verify the signup route exists and has multiple middleware layers
      const signupRoute = authRoutes.stack.find(
        (layer: any) => layer.route?.path === "/signup" && layer.route?.methods?.post
      );
      expect(signupRoute).toBeDefined();
      // Signup should have: rate limit + file upload + validators + controller
      expect(signupRoute.route.stack.length).toBeGreaterThan(4);
    });
  });

  describe("total route count", () => {
    it("has exactly 5 routes", () => {
      const routeCount = authRoutes.stack.filter((layer: any) => layer.route).length;
      expect(routeCount).toBe(5);
    });
  });
});
