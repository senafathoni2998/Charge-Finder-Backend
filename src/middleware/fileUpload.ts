import fs from "fs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { getImageUploadDir } from "../utils/image-paths";
import HttpError from "../models/http-error";

const MIME_TYPE_MAP = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpg",
};
type MimeType = keyof typeof MIME_TYPE_MAP;

const fileUpload = multer({
  limits: { fileSize: 500000 },
  storage: multer.diskStorage({
    filename: (req, file: Express.Multer.File, cb) => {
      const mimeType = file.mimetype as MimeType;
      const ext = MIME_TYPE_MAP[mimeType];

      cb(null, uuidv4() + "." + ext);
    },
    destination: (req, file, cb) => {
      const uploadPath = getImageUploadDir();
      try {
        fs.mkdirSync(uploadPath, { recursive: true });
      } catch (error) {
        cb(error as Error, uploadPath);
        return;
      }
      cb(null, uploadPath);
    },
  }),
  fileFilter: (
    req,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) => {
    const mimeType = file.mimetype as MimeType;
    const isValid = !!MIME_TYPE_MAP[mimeType];
    if (isValid) {
      cb(null, true);
      return;
    }
    // A rejected file type is a client error, not a server fault — surface it as a
    // 415 (HttpError.code) so the error handler returns a clean 4xx with this
    // message instead of falling through to a logged, generic 500.
    cb(new HttpError("Only PNG and JPG images are allowed.", 415));
  },
});

export { fileUpload };
