export {};

import { promises as fs } from "fs";
import path from "path";
import {
  IMAGE_UPLOAD_ROOT,
  IMAGE_PUBLIC_ROOT,
  getImageUploadDir,
  getPublicImagePathFromFile,
  deletePublicImageFile,
} from "../image-paths";

// Mock fs promises
jest.mock("fs", () => ({
  promises: {
    unlink: jest.fn(),
  },
}));

describe("utils/image-paths", () => {
  const SEP = path.sep;

  describe("constants", () => {
    it("IMAGE_UPLOAD_ROOT should be uploads/images", () => {
      expect(IMAGE_UPLOAD_ROOT).toBe(path.join("uploads", "images"));
    });

    it("IMAGE_PUBLIC_ROOT should be uploads/images", () => {
      expect(IMAGE_PUBLIC_ROOT).toBe("uploads/images");
    });
  });

  describe("getImageUploadDir", () => {
    it("returns directory based on current date by default", () => {
      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const expected = path.join(IMAGE_UPLOAD_ROOT, year, month);
      
      expect(getImageUploadDir()).toBe(expected);
    });

    it("returns directory based on provided date", () => {
      const date = new Date("2023-05-15");
      const expected = path.join(IMAGE_UPLOAD_ROOT, "2023", "05");
      
      expect(getImageUploadDir(date)).toBe(expected);
    });
  });

  describe("getPublicImagePathFromFile", () => {
    it("constructs public path from file destination and filename", () => {
      const file = {
        destination: path.join("uploads", "images", "2023", "05"),
        filename: "test-image.jpg",
      } as Express.Multer.File;

      const result = getPublicImagePathFromFile(file);
      // Public path uses forward slashes (posix)
      expect(result).toBe("uploads/images/2023/05/test-image.jpg");
    });

    it("handles destination exactly at upload root", () => {
      const file = {
        destination: path.join("uploads", "images"),
        filename: "root-image.jpg",
      } as Express.Multer.File;

      const result = getPublicImagePathFromFile(file);
      expect(result).toBe("uploads/images/root-image.jpg");
    });

    it("handles deeply nested paths", () => {
      const file = {
        destination: path.join("uploads", "images", "2023", "05", "nested"),
        filename: "nested.jpg",
      } as Express.Multer.File;

      const result = getPublicImagePathFromFile(file);
      expect(result).toBe("uploads/images/2023/05/nested/nested.jpg");
    });
  });

  describe("deletePublicImageFile", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("deletes file if path is within public root", async () => {
      const imagePath = "uploads/images/2023/05/test.jpg";
      
      // Spy on path.resolve to verify it's called
      const resolveSpy = jest.spyOn(path, "resolve");
      
      await deletePublicImageFile(imagePath);
      
      expect(fs.unlink).toHaveBeenCalled();
      // Verify correct path passed to unlink (resolved absolute path)
      const expectedPath = path.resolve(imagePath);
      expect(fs.unlink).toHaveBeenCalledWith(expectedPath);
    });

    it("handles paths starting with slash", async () => {
      const imagePath = "/uploads/images/2023/05/test.jpg";
      
      await deletePublicImageFile(imagePath);
      
      expect(fs.unlink).toHaveBeenCalled();
      const expectedPath = path.resolve("uploads/images/2023/05/test.jpg");
      expect(fs.unlink).toHaveBeenCalledWith(expectedPath);
    });

    it("handles paths with backslashes (Windows style)", async () => {
      const imagePath = "uploads\\images\\2023\\05\\test.jpg";
      
      await deletePublicImageFile(imagePath);
      
      expect(fs.unlink).toHaveBeenCalled();
    });

    it("does nothing if path is not in public root", async () => {
      const imagePath = "other/folder/test.jpg";
      
      await deletePublicImageFile(imagePath);
      
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it("does nothing if path attempts traversal out of public root", async () => {
      // NOTE: The implementation checks startsWith string matching, 
      // so "../uploads/images" might fail the check directly, 
      // but let's test a path that clearly doesn't start with uploads/images
      const imagePath = "../etc/passwd";
      
      await deletePublicImageFile(imagePath);
      
      expect(fs.unlink).not.toHaveBeenCalled();
    });
    
    it("propagates fs errors", async () => {
      const imagePath = "uploads/images/test.jpg";
      (fs.unlink as jest.Mock).mockRejectedValue(new Error("File not found"));
      
      await expect(deletePublicImageFile(imagePath)).rejects.toThrow("File not found");
    });
  });
});
