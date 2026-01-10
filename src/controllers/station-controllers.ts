import { Request, Response, NextFunction } from "express";

import HttpError from "../models/http-error";
import Station from "../models/station";

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

export { getStations };
