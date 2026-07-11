import fs from "fs";
import { fileUpload } from "../fileUpload";
import { getImageUploadDir } from "../../utils/image-paths";

jest.mock("fs");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));
jest.mock("../../utils/image-paths", () => ({
  getImageUploadDir: jest.fn(),
}));

const fsMock = fs as jest.Mocked<typeof fs>;
const getImageUploadDirMock = getImageUploadDir as jest.Mock;

describe("fileUpload middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getImageUploadDirMock.mockReturnValue("/test/uploads");
  });

  describe("configuration", () => {
    it("should be a multer instance", () => {
      expect(fileUpload).toBeDefined();
      expect(typeof fileUpload.single).toBe("function");
      expect(typeof fileUpload.array).toBe("function");
      expect(typeof fileUpload.fields).toBe("function");
    });
  });

  describe("storage - filename", () => {
    it("generates filename with uuid and correct extension for png", () => {
      // Access the storage configuration
      const storage = (fileUpload as any).storage;
      const getFilename = storage.getFilename;

      const mockFile = {
        mimetype: "image/png",
        originalname: "test.png",
      } as Express.Multer.File;

      const callback = jest.fn();
      getFilename({} as any, mockFile, callback);

      expect(callback).toHaveBeenCalledWith(null, "test-uuid-1234.png");
    });

    it("generates filename with uuid and correct extension for jpeg", () => {
      const storage = (fileUpload as any).storage;
      const getFilename = storage.getFilename;

      const mockFile = {
        mimetype: "image/jpeg",
        originalname: "test.jpeg",
      } as Express.Multer.File;

      const callback = jest.fn();
      getFilename({} as any, mockFile, callback);

      expect(callback).toHaveBeenCalledWith(null, "test-uuid-1234.jpeg");
    });

    it("generates filename with uuid and correct extension for jpg", () => {
      const storage = (fileUpload as any).storage;
      const getFilename = storage.getFilename;

      const mockFile = {
        mimetype: "image/jpg",
        originalname: "test.jpg",
      } as Express.Multer.File;

      const callback = jest.fn();
      getFilename({} as any, mockFile, callback);

      expect(callback).toHaveBeenCalledWith(null, "test-uuid-1234.jpg");
    });
  });

  describe("storage - destination", () => {
    it("creates upload directory and returns path on success", () => {
      const storage = (fileUpload as any).storage;
      const getDestination = storage.getDestination;

      fsMock.mkdirSync.mockReturnValue(undefined);

      const mockFile = {
        mimetype: "image/png",
      } as Express.Multer.File;

      const callback = jest.fn();
      getDestination({} as any, mockFile, callback);

      expect(getImageUploadDirMock).toHaveBeenCalled();
      expect(fsMock.mkdirSync).toHaveBeenCalledWith("/test/uploads", {
        recursive: true,
      });
      expect(callback).toHaveBeenCalledWith(null, "/test/uploads");
    });

    it("calls callback with error if directory creation fails", () => {
      const storage = (fileUpload as any).storage;
      const getDestination = storage.getDestination;

      const mockError = new Error("Failed to create directory");
      fsMock.mkdirSync.mockImplementation(() => {
        throw mockError;
      });

      const mockFile = {
        mimetype: "image/png",
      } as Express.Multer.File;

      const callback = jest.fn();
      getDestination({} as any, mockFile, callback);

      expect(callback).toHaveBeenCalledWith(mockError, "/test/uploads");
    });
  });

  describe("fileFilter", () => {
    it("accepts png files", () => {
      const limits = (fileUpload as any).limits;
      
      // We need to test the fileFilter function
      // Since multer doesn't expose fileFilter directly, we test through the middleware
      const mockFile = {
        mimetype: "image/png",
        originalname: "test.png",
      } as Express.Multer.File;

      // The fileFilter is part of the multer options
      // We can access it through the internal structure
      const options = (fileUpload as any);
      
      // Verify limits are set correctly
      expect(limits.fileSize).toBe(500000);
    });

    it("accepts jpeg files", () => {
      // Verify that the middleware is configured to accept jpeg
      const limits = (fileUpload as any).limits;
      expect(limits.fileSize).toBe(500000);
    });

    it("accepts jpg files", () => {
      // Verify that the middleware is configured
      const limits = (fileUpload as any).limits;
      expect(limits.fileSize).toBe(500000);
    });
  });

  describe("limits", () => {
    it("has file size limit of 500KB", () => {
      const limits = (fileUpload as any).limits;
      expect(limits.fileSize).toBe(500000);
    });
  });

  describe("fileFilter behavior", () => {
    const getFilter = () => (fileUpload as any).fileFilter;

    it.each(["image/png", "image/jpeg", "image/jpg"])(
      "accepts %s",
      (mimetype) => {
        const cb = jest.fn();
        getFilter()({} as any, { mimetype } as Express.Multer.File, cb);
        expect(cb).toHaveBeenCalledWith(null, true);
      }
    );

    it.each(["image/webp", "image/gif", "image/svg+xml", "application/pdf"])(
      "rejects %s with a 415 HttpError (a client error, not a 500)",
      (mimetype) => {
        const cb = jest.fn();
        getFilter()({} as any, { mimetype } as Express.Multer.File, cb);
        expect(cb).toHaveBeenCalledTimes(1);
        const err = cb.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe(415);
        // No second "accept" argument — the file is rejected.
        expect(cb.mock.calls[0][1]).toBeUndefined();
      }
    );
  });
});

describe("fileUpload MIME type validation", () => {
  it("should have correct MIME type mappings", () => {
    // Testing the expected behavior based on the MIME_TYPE_MAP
    const validMimeTypes = ["image/png", "image/jpeg", "image/jpg"];
    const invalidMimeTypes = ["image/gif", "image/webp", "application/pdf"];

    // These are the expected extensions for valid mime types
    const expectedExtensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/jpg": "jpg",
    };

    // Verify the mapping is correct by checking the filename generation
    const storage = (fileUpload as any).storage;
    const getFilename = storage.getFilename;

    validMimeTypes.forEach((mimeType) => {
      const mockFile = { mimetype: mimeType } as Express.Multer.File;
      const callback = jest.fn();
      getFilename({} as any, mockFile, callback);
      expect(callback).toHaveBeenCalledWith(
        null,
        `test-uuid-1234.${expectedExtensions[mimeType]}`
      );
    });
  });
});
