export {};

import bcrypt from "bcryptjs";
import { ensureAdminUser } from "../ensure-admin";

// Mock User model
jest.mock("../../models/user", () => {
  const mockSave = jest.fn();
  const MockUser = jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave,
  }));
  (MockUser as any).findOne = jest.fn();
  (MockUser as any).save = mockSave;
  return {
    __esModule: true,
    default: MockUser,
  };
});

const User = require("../../models/user").default;

describe("startup/ensure-admin", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Default mocks
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does nothing if admin user already exists", async () => {
    // Setup existing admin
    User.findOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ email: "existing@admin.com" }),
      }),
    });

    // Mock console.log to avoid noise
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await ensureAdminUser();

    expect(User.findOne).toHaveBeenCalledWith({ role: "admin" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Admin user exists")
    );
    // Should not create new user
    expect(User).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("warns if config is missing", async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await ensureAdminUser();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No admin user found")
    );

    consoleSpy.mockRestore();
  });

  it("promotes existing user if email matches", async () => {
    process.env.ADMIN_EMAIL = "new@admin.com";
    process.env.ADMIN_PASSWORD = "password123";

    // No existing admin role
    User.findOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    // But user exists by email
    const mockSave = jest.fn().mockResolvedValue(undefined);
    const existingUser = {
      email: "new@admin.com",
      role: "user",
      save: mockSave,
    };
    User.findOne.mockResolvedValueOnce(existingUser);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await ensureAdminUser();

    expect(existingUser.role).toBe("admin");
    expect(mockSave).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Promoted user to admin")
    );

    consoleSpy.mockRestore();
  });

  it("creates new admin user if not exists", async () => {
    process.env.ADMIN_EMAIL = "new@admin.com";
    process.env.ADMIN_PASSWORD = "password123";
    process.env.ADMIN_NAME = "Super Admin";
    process.env.ADMIN_REGION = "HQ";

    // No existing admin role
    User.findOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    // No existing user by email
    User.findOne.mockResolvedValueOnce(null);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await ensureAdminUser();

    // Verify hashing
    // Note: bcrypt.hash is not mocked here but assumes implementation calls it. 
    // Usually we should check expected calls if we mocked bcrypt, but let's rely on integration or ensure bcrypt works.
    // Actually, usually it's better to verify the User constructor args.
    
    expect(User).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@admin.com",
        name: "Super Admin",
        region: "HQ",
        role: "admin",
      })
    );
    
    // Verify save is called on instance
    const mockInstance = User.mock.results[0].value;
    expect(mockInstance.save).toHaveBeenCalled();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Admin user created")
    );

    consoleSpy.mockRestore();
  });

  it("handles errors gracefully", async () => {
    const error = new Error("DB Error");
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(error),
      }),
    });

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await ensureAdminUser();

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to ensure admin user:",
      error
    );

    consoleSpy.mockRestore();
  });
});
