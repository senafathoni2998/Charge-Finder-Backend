import fs from "fs";
import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../../models/http-error";
import Station, { toGeoPoint } from "../../models/station";
import { invalidateStation } from "../../services/station-cache";
import {
  deletePublicImageFile,
  getPublicImagePathFromFile,
} from "../../utils/image-paths";

// multer writes the uploaded feature image to disk BEFORE validators/controllers
// run. On any path that returns without persisting it (validation failure, missing
// station, DB error), delete the orphaned file so failed uploads don't accumulate.
const cleanupUploadedFile = async (file?: Express.Multer.File) => {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch {
    // Best-effort — a leftover temp file must not turn one failure into another.
  }
};

/**
 * Creates a new charging station
 * 
 * @purpose Admin endpoint to add new charging stations to the network
 * @validates Validates all station details including connectors, pricing, and location
 * @body name, lat, lng, address, connectors, status, lastUpdatedISO, photos, pricing, amenities, notes
 * @returns JSON response with created station details
 */
const addStation = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    await cleanupUploadedFile(req.file);
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const {
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos = [],
    pricing,
    amenities = [],
    notes,
  } = req.body;

  const newStation = new Station({
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos,
    // Set from the uploaded multipart file when present (utils/image-paths gives
    // the public path); omitted otherwise so gradient photos remain the fallback.
    ...(req.file ? { featuredImage: getPublicImagePathFromFile(req.file) } : {}),
    pricing,
    amenities,
    notes,
    location: toGeoPoint(lat, lng),
  });

  try {
    await newStation.save();
  } catch (err) {
    await cleanupUploadedFile(req.file);
    return next(
      new HttpError("Creating station failed, please try again.", 500)
    );
  }

  res.status(201).json({
    message: "New station added successfully!",
    station: newStation.toObject({ getters: true }),
  });
};

/**
 * Updates an existing charging station's information
 * 
 * @purpose Admin endpoint to modify station details, availability, pricing, etc.
 * @validates Validates input and checks station exists
 * @body stationId, name, lat, lng, address, connectors, status, lastUpdatedISO, photos, pricing, amenities, notes (all optional except stationId)
 * @returns JSON response with updated station details
 * @note All fields are optional except stationId - only provided fields are updated
 */
const updateStation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    await cleanupUploadedFile(req.file);
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const {
    stationId,
    name,
    lat,
    lng,
    address,
    connectors,
    status,
    lastUpdatedISO,
    photos,
    pricing,
    amenities,
    notes,
    removeFeaturedImage,
  } = req.body;

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    await cleanupUploadedFile(req.file);
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  if (!station) {
    await cleanupUploadedFile(req.file);
    return next(new HttpError("Station not found.", 404));
  }

  // Feature image: a new upload replaces the current one; an explicit
  // removeFeaturedImage flag clears it. In both cases the previous file is
  // deleted from disk after the save succeeds (mirrors the profile-image flow).
  const previousImagePath = station.featuredImage;
  let imageReplacedOrRemoved = false;
  if (req.file) {
    station.featuredImage = getPublicImagePathFromFile(req.file);
    imageReplacedOrRemoved = true;
  } else if (removeFeaturedImage === true) {
    station.featuredImage = null;
    imageReplacedOrRemoved = true;
  }

  if (typeof name === "string") {
    station.name = name;
  }

  if (lat !== undefined) {
    station.lat = lat;
  }

  if (lng !== undefined) {
    station.lng = lng;
  }

  // Keep the GeoJSON location in sync whenever coordinates change.
  if (lat !== undefined || lng !== undefined) {
    station.set("location", toGeoPoint(station.lat, station.lng));
  }

  if (typeof address === "string") {
    station.address = address;
  }

  if (Array.isArray(connectors)) {
    station.set("connectors", connectors);
  }

  if (status === "AVAILABLE" || status === "BUSY" || status === "OFFLINE") {
    station.status = status;
  }

  if (typeof lastUpdatedISO === "string") {
    station.lastUpdatedISO = lastUpdatedISO;
  }

  if (Array.isArray(photos)) {
    station.set("photos", photos);
  }

  if (pricing !== undefined) {
    station.pricing = pricing;
  }

  if (Array.isArray(amenities)) {
    station.amenities = amenities;
  }

  if (typeof notes === "string") {
    station.notes = notes;
  }

  try {
    await station.save();
  } catch (err) {
    await cleanupUploadedFile(req.file);
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  // Best-effort cleanup of the replaced/removed image. A failure here must not
  // fail the request — the station was already updated successfully.
  if (
    imageReplacedOrRemoved &&
    previousImagePath &&
    previousImagePath !== station.featuredImage
  ) {
    try {
      await deletePublicImageFile(previousImagePath);
    } catch (err) {
      // Ignore — orphaned files are harmless and not worth a 500 here.
    }
  }

  await invalidateStation(stationId);

  res.status(200).json({
    message: "Station updated successfully!",
    station: station.toObject({ getters: true }),
  });
};

/**
 * Deletes a charging station from the network
 * 
 * @purpose Admin endpoint to remove a station from the system
 * @validates Checks station exists before deletion
 * @body stationId
 * @returns JSON response confirming deletion
 * @warning This does not cascade delete related charging tickets - handle with care
 */
const deleteStation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new HttpError("Invalid inputs passed, please check your data.", 422)
    );
  }

  const { stationId } = req.body;

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Deleting station failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
  }

  const featuredImagePath = station.featuredImage;

  try {
    await station.deleteOne();
  } catch (err) {
    return next(
      new HttpError("Deleting station failed, please try again.", 500)
    );
  }

  // Best-effort removal of the station's feature image from disk.
  if (featuredImagePath) {
    try {
      await deletePublicImageFile(featuredImagePath);
    } catch (err) {
      // Ignore — a leftover file must not fail an otherwise-successful delete.
    }
  }

  await invalidateStation(stationId);

  res.status(200).json({ message: "Station deleted successfully!" });
};

export { addStation, updateStation, deleteStation };
