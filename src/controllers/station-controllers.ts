import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

import HttpError from "../models/http-error";
import Station from "../models/station";

const addStation = async (
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

  let newStation = new Station({
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
  });

  try {
    await newStation.save();
  } catch (err) {
    return next(new HttpError("Creating station failed, please try again.", 500));
  }

  res.status(201).json({
    message: "New station added successfully!",
    station: newStation.toObject({ getters: true }),
  });
};

const updateStation = async (
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
  } = req.body;

  let station;
  try {
    station = await Station.findById(stationId);
  } catch (err) {
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  if (!station) {
    return next(new HttpError("Station not found.", 404));
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
    return next(
      new HttpError("Updating station failed, please try again.", 500)
    );
  }

  res.status(200).json({
    message: "Station updated successfully!",
    station: station.toObject({ getters: true }),
  });
};

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

  try {
    await station.deleteOne();
  } catch (err) {
    return next(
      new HttpError("Deleting station failed, please try again.", 500)
    );
  }

  res.status(200).json({ message: "Station deleted successfully!" });
};

const getStations = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let stations;
  try {
    stations = await Station.find();
  } catch (err) {
    return next(
      new HttpError("Fetching stations failed, please try again later.", 500)
    );
  }

  if (!stations || stations.length === 0) {
    return next(new HttpError("Could not find stations.", 404));
  }

  res.json({
    stations: stations.map((station) => station.toObject({ getters: true })),
  });
};

export { addStation, updateStation, deleteStation, getStations };
