import { promises as fs } from "fs";
import path from "path";

const IMAGE_UPLOAD_ROOT = path.join("uploads", "images");
const IMAGE_PUBLIC_ROOT = "uploads/images";

const getImageUploadDir = (date = new Date()) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return path.join(IMAGE_UPLOAD_ROOT, year, month);
};

const getPublicImagePathFromFile = (file: Express.Multer.File) => {
  const relativeDest = path.relative(IMAGE_UPLOAD_ROOT, file.destination);
  const destParts = relativeDest ? relativeDest.split(path.sep) : [];
  return path.posix.join(IMAGE_PUBLIC_ROOT, ...destParts, file.filename);
};

const normalizePublicPath = (imagePath: string) =>
  imagePath.replace(/\\/g, "/");

const isImagePublicPath = (imagePath: string) => {
  const normalizedPath = normalizePublicPath(imagePath);
  return (
    normalizedPath.startsWith(IMAGE_PUBLIC_ROOT) ||
    normalizedPath.startsWith(`/${IMAGE_PUBLIC_ROOT}`)
  );
};

const resolvePublicImagePath = (imagePath: string) => {
  const normalizedPath = normalizePublicPath(imagePath);
  const relativePath = normalizedPath.startsWith("/")
    ? normalizedPath.slice(1)
    : normalizedPath;
  return path.resolve(relativePath);
};

const deletePublicImageFile = async (imagePath: string) => {
  if (!isImagePublicPath(imagePath)) {
    return;
  }
  const filePath = resolvePublicImagePath(imagePath);
  await fs.unlink(filePath);
};

export {
  IMAGE_UPLOAD_ROOT,
  IMAGE_PUBLIC_ROOT,
  getImageUploadDir,
  getPublicImagePathFromFile,
  deletePublicImageFile,
};
