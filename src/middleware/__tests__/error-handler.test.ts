import { errorHandler, notFoundHandler } from "../error-handler";
import HttpError from "../../models/http-error";
import { NotFoundError } from "../../errors";

const buildRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.headersSent = false;
  return res;
};

describe("error-handler middleware", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("notFoundHandler", () => {
    it("forwards a 404 error", () => {
      const next = jest.fn();
      notFoundHandler({} as any, {} as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(HttpError));
      expect(next.mock.calls[0][0].code).toBe(404);
    });
  });

  describe("errorHandler", () => {
    it("uses an HttpError's status and message", () => {
      const res = buildRes();
      errorHandler(new HttpError("nope", 403), {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "nope" });
    });

    it("uses a semantic error's status (NotFoundError -> 404)", () => {
      const res = buildRes();
      errorHandler(new NotFoundError("gone"), {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "gone" });
    });

    it("maps a Mongoose CastError to 400", () => {
      const res = buildRes();
      errorHandler({ name: "CastError" }, {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("maps a Mongoose ValidationError to 422", () => {
      const res = buildRes();
      errorHandler({ name: "ValidationError" }, {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it("maps a duplicate-key error to 409", () => {
      const res = buildRes();
      errorHandler({ code: 11000 }, {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it("maps a Multer error (string code) to 400, not an invalid status", () => {
      const res = buildRes();
      errorHandler(
        { name: "MulterError", code: "LIMIT_FILE_SIZE", message: "File too large" },
        {} as any,
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "File too large" });
    });

    it("falls back to 500 for an unknown Error", () => {
      const res = buildRes();
      errorHandler(new Error("boom"), {} as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "boom" });
    });

    it("delegates to next when headers are already sent", () => {
      const res = buildRes();
      res.headersSent = true;
      const next = jest.fn();
      const err = new Error("late");
      errorHandler(err, {} as any, res, next);
      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
