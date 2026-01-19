/**
 * ⚡ CHARGING TICKET SERVICE
 * 
 * This service handles all aspects of the EV (Electric Vehicle) charging workflow,
 * including battery calculations, charging progress tracking, and ticket management.
 * 
 * ## EV CHARGING WORKFLOW:
 * 1. **Request Ticket**: User requests charging at a station
 * 2. **Start Charging**: User plugs in and begins charging session
 * 3. **Track Progress**: System monitors charging progress in real-time
 * 4. **Complete/Cancel**: Session ends when complete or user cancels
 * 
 * ## KEY CONCEPTS:
 * - **Charging Speed**: NORMAL (slowest), FAST, ULTRA_FAST (fastest)
 * - **Battery Percentage**: Vehicle battery level (0-100%)
 * - **Charging Duration**: Time to charge from current to target battery level
 * - **Progress Percent**: How much of charging session is complete (0-100%)
 * - **Ticket**: Record of a charging session request/in-progress
 * 
 * ## BATTERY CALCULATIONS:
 * - Duration depends on: current battery %, target battery %, charging speed
 * - Progress = (time elapsed / total duration) × 100
 * - Current battery = starting % + (progress × battery to charge)
 */

import mongoose from "mongoose";

import ChargingTicket from "../models/charging-ticket";
import Station from "../models/station";
import User from "../models/user";
import Vehicle from "../models/vehicle";
import {
  calculateBatteryStatus,
  refreshVehicleBatterySnapshot,
} from "./vehicle-battery-service";

// ============================================================================
// CHARGING SPEED & DURATION CONFIGURATION
// ============================================================================

/**
 * Defines the three charging speed levels available for EV charging.
 * Different speeds affect charging time and cost.
 */
export type ChargingSpeed = "NORMAL" | "FAST" | "ULTRA_FAST";

/**
 * Maximum charging duration for each speed level (in milliseconds).
 * 
 * These represent the time to charge from 0% to 100% battery:
 * - NORMAL: 7 minutes (slower charging, typically cheaper)
 * - FAST: 5 minutes (moderate speed, moderate cost)
 * - ULTRA_FAST: 3 minutes (fastest charging, typically more expensive)
 * 
 * Note: Actual duration is calculated based on current battery level
 * and may be shorter if battery isn't empty.
 */
const CHARGING_SPEED_MAX_DURATION_MS: Record<ChargingSpeed, number> = {
  NORMAL: 7 * 60 * 1000,      // 7 minutes in milliseconds
  FAST: 5 * 60 * 1000,        // 5 minutes in milliseconds
  ULTRA_FAST: 3 * 60 * 1000,  // 3 minutes in milliseconds
};

/**
 * Default charging duration used when speed is not specified.
 * Defaults to NORMAL speed (7 minutes).
 */
export const CHARGING_DURATION_MS = CHARGING_SPEED_MAX_DURATION_MS.NORMAL;

/**
 * How often to update charging progress (in milliseconds).
 * Every 30 seconds, the system recalculates and broadcasts progress.
 */
export const CHARGING_PERCENT_INTERVAL_MS = 30 * 1000; // 30 seconds


// ============================================================================
// UTILITY FUNCTIONS - Data Validation & Normalization
// ============================================================================

/**
 * Clamps battery percentage to valid range (0-100%).
 * 
 * @param value - Raw battery percentage value
 * @returns Battery percentage between 0 and 100, rounded to nearest integer
 * @example clampBatteryPercent(105) → 100
 * @example clampBatteryPercent(-5) → 0
 * @example clampBatteryPercent(75.7) → 76
 */
const clampBatteryPercent = (value: number) => {
  // Return 0 if value is not a valid finite number (e.g., NaN, Infinity)
  if (!Number.isFinite(value)) {
    return 0;
  }

  // Clamp between 0 and 100, then round to nearest integer
  // Math.max ensures not below 0
  // Math.min ensures not above 100
  return Math.min(100, Math.max(0, Math.round(value)));
};

/**
 * Validates and returns battery capacity in kWh (kilowatt-hours).
 * 
 * @param value - Raw battery capacity value
 * @returns Valid battery capacity or null if invalid
 * @example resolveBatteryCapacity(75) → 75 (valid capacity)
 * @example resolveBatteryCapacity(0) → null (capacity must be > 0)
 * @example resolveBatteryCapacity("75") → null (must be number)
 */
const resolveBatteryCapacity = (value: unknown) => {
  // Validate: must be a finite number greater than 0
  // Battery capacity of 0 or negative doesn't make sense
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
};

/**
 * Extracts battery capacity from vehicle information object.
 * 
 * @param value - Vehicle info object or unknown value
 * @returns Validated battery capacity or null
 * @example resolveBatteryCapacityFromInfo({batteryCapacity: 75}) → 75
 */
const resolveBatteryCapacityFromInfo = (value: unknown) => {
  // Check if value is an object containing battery info
  if (!value || typeof value !== "object") {
    return null;
  }

  // Extract batteryCapacity field and validate it
  return resolveBatteryCapacity(
    (value as { batteryCapacity?: unknown }).batteryCapacity
  );
};

/**
 * Validates requested charging amount in kWh.
 * 
 * @param value - Raw kWh value from ticket
 * @returns Valid kWh amount or null if invalid
 * @example resolveTicketKwh(20) → 20 (valid amount)
 * @example resolveTicketKwh(0) → null (must request > 0 kWh)
 */
const resolveTicketKwh = (value: unknown) => {
  // kWh must be a positive finite number
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
};

/**
 * Normalizes charging speed to valid enum value.
 * 
 * @param value - Raw charging speed value
 * @returns Valid ChargingSpeed enum, defaults to "NORMAL" if invalid
 * @example resolveChargingSpeed("FAST") → "FAST"
 * @example resolveChargingSpeed("super_fast") → "NORMAL" (default)
 */
const resolveChargingSpeed = (value: unknown): ChargingSpeed => {
  // Check if value matches one of the valid charging speeds
  if (value === "FAST" || value === "ULTRA_FAST" || value === "NORMAL") {
    return value;
  }

  // Default to NORMAL speed if unrecognized
  return "NORMAL";
};

/**
 * Gets maximum charging duration for a given charging speed.
 * 
 * @param chargingSpeed - Charging speed enum (NORMAL, FAST, ULTRA_FAST)
 * @returns Duration in milliseconds to charge from 0% to 100%
 * @example getMaxChargingDurationMs("ULTRA_FAST") → 180000 (3 minutes)
 */
const getMaxChargingDurationMs = (chargingSpeed: unknown) => {
  // Normalize speed and look up corresponding duration
  return CHARGING_SPEED_MAX_DURATION_MS[resolveChargingSpeed(chargingSpeed)];
};

// ============================================================================
// CALCULATION FUNCTIONS - Charging Progress & Battery Math
// ============================================================================

/**
 * Calculates how much of the charging session is complete.
 * 
 * Formula: (time elapsed / total duration) × 100
 * 
 * @param startedAt - When charging started
 * @param nowMs - Current time in milliseconds (default: Date.now())
 * @param durationMs - Total expected charging duration
 * @returns Progress percentage (0-100)
 * 
 * @example
 * // Charging started 2 min ago, expected to take 5 min total
 * calculateChargingProgressPercent(twoMinutesAgo, now, 5min)
 * // Returns: 40 (40% complete)
 */
export const calculateChargingProgressPercent = (
  startedAt: Date | null | undefined,
  nowMs = Date.now(),
  durationMs = CHARGING_DURATION_MS
) => {
  // If no start time, charging hasn't begun
  if (!startedAt) {
    return 0;
  }

  // If duration is invalid, consider it complete
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 100;
  }

  // Calculate time elapsed since charging started
  const elapsedMs = nowMs - startedAt.getTime();
  
  // If elapsed is negative (future start time), charging hasn't started
  if (elapsedMs <= 0) {
    return 0;
  }

  // Calculate progress as percentage: (elapsed / total) × 100
  const percent = (elapsedMs / durationMs) * 100;
  
  // Clamp to 0-100 range and round to nearest integer
  return Math.min(100, Math.max(0, Math.round(percent)));
};

/**
 * Calculates when charging is expected to complete.
 * 
 * Formula: start time + duration
 * 
 * @param startedAt - When charging started
 * @param durationMs - Total charging duration
 * @returns Estimated completion Date or null if can't calculate
 * 
 * @example
 * // Started at 2:00 PM, takes 5 minutes
 * calculateEstimatedCompletionAt(2:00PM, 5min)
 * // Returns: Date object for 2:05 PM
 */
export const calculateEstimatedCompletionAt = (
  startedAt: Date | null | undefined,
  durationMs = CHARGING_DURATION_MS
) => {
  // Can't calculate without start time
  if (!startedAt) {
    return null;
  }

  // Get start time as timestamp
  const startedAtMs = startedAt.getTime();
  
  // If start time is invalid, can't calculate
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  // Add duration to start time to get completion time
  return new Date(startedAtMs + durationMs);
};

/**
 * Adds estimated completion time to a ticket snapshot.
 * 
 * @param ticketSnapshot - Current ticket data
 * @param startedAt - When charging started
 * @param durationMs - Total charging duration
 * @returns Ticket snapshot with estimatedCompletionAt added
 */
export const appendChargingEstimate = (
  ticketSnapshot: Record<string, unknown>,
  startedAt: Date | null | undefined,
  durationMs = CHARGING_DURATION_MS
) => {
  // Calculate when charging will be done
  const estimatedCompletionAt = calculateEstimatedCompletionAt(
    startedAt,
    durationMs
  );
  
  // If we couldn't calculate it, return ticket unchanged
  if (!estimatedCompletionAt) {
    return ticketSnapshot;
  }

  // Add estimated completion time to ticket
  return {
    ...ticketSnapshot,
    estimatedCompletionAt,
  };
};

/**
 * Calculates how long charging will take based on battery level.
 * 
 * Takes into account:
 * - Current battery percentage
 * - Target battery percentage (default 100%)
 * - Charging speed (affects base duration)
 * 
 * Formula: (battery % needed / 100) × max duration for speed
 * 
 * @param batteryPercent - Current battery level (0-100)
 * @param chargingSpeed - Charging speed (affects duration)
 * @param targetBatteryPercent - Desired end battery level (default 100)
 * @returns Duration in milliseconds
 * 
 * @example
 * // Current: 30%, Target: 80%, Speed: FAST (5min for 0-100%)
 * calculateChargingDurationMs(30, "FAST", 80)
 * // Returns: 150000 (2.5 minutes = 50% of 5 minutes)
 */
export const calculateChargingDurationMs = (
  batteryPercent: number | null | undefined,
  chargingSpeed?: ChargingSpeed | null,
  targetBatteryPercent?: number | null
) => {
  // Get maximum duration for this charging speed (0% to 100%)
  const maxDurationMs = getMaxChargingDurationMs(chargingSpeed);
  
  // If we don't have valid current battery level, use max duration
  if (typeof batteryPercent !== "number" || !Number.isFinite(batteryPercent)) {
    return maxDurationMs;
  }

  // Normalize current battery to 0-100 range
  const normalizedPercent = clampBatteryPercent(batteryPercent);
  
  // Determine target battery percentage (default to 100% if not specified)
  // Must validate it's a finite number before using it
  const normalizedTarget =
    typeof targetBatteryPercent === "number" &&
    Number.isFinite(targetBatteryPercent)
      ? clampBatteryPercent(targetBatteryPercent) // Ensure target is between 0-100
      : 100; // Default to fully charged
  
  // Calculate how much battery needs to be charged
  // Example: 30% → 80% means 50% needs charging
  const remainingPercent = Math.max(0, normalizedTarget - normalizedPercent);
  
  // Calculate duration: (% needed / 100) × max duration
  // Example: (50 / 100) × 300000ms = 150000ms (2.5 min)
  return Math.max(0, Math.round((remainingPercent / 100) * maxDurationMs));
};

/**
 * Calculates current battery percentage during charging.
 * 
 * Interpolates between starting and target battery based on progress.
 * 
 * Formula: starting % + (progress × battery range to charge)
 * 
 * @param progressPercent - Charging progress (0-100)
 * @param startingBatteryPercent - Battery % when started
 * @param targetBatteryPercent - Target battery % (default 100)
 * @returns Current estimated battery percentage
 * 
 * @example
 * // Started at 30%, targeting 80%, currently 50% complete
 * calculateChargingBatteryPercentage(50, 30, 80)
 * // Range: 80 - 30 = 50%
 * // Progress: 50% of range = 25%
 * // Current: 30 + 25 = 55%
 */
export const calculateChargingBatteryPercentage = (
  progressPercent: number,
  startingBatteryPercent: number,
  targetBatteryPercent = 100
) => {
  // Normalize all values to 0-100 range
  const normalizedProgress = clampBatteryPercent(progressPercent);
  const normalizedStart = clampBatteryPercent(startingBatteryPercent);
  const normalizedTarget = clampBatteryPercent(targetBatteryPercent);
  
  // Target must be at least starting value
  // (can't charge to lower than current level)
  const effectiveTarget = Math.max(normalizedStart, normalizedTarget);
  
  // Calculate range of battery to charge
  // Example: 80% - 30% = 50% range
  const remaining = effectiveTarget - normalizedStart;
  
  // Calculate current battery based on progress
  // Example: 30% + (50% × 50/100) = 30% + 25% = 55%
  const estimatedPercent =
    normalizedStart + (remaining * normalizedProgress) / 100;
  
  // Ensure result doesn't exceed target and is within 0-100
  return clampBatteryPercent(Math.min(effectiveTarget, estimatedPercent));
};

// ============================================================================
// BATTERY RESOLUTION FUNCTIONS - Extract & Calculate Battery Data
// ============================================================================

/**
 * Extracts battery percentage from vehicle information object.
 * 
 * @param vehicleInfo - Vehicle data object
 * @returns Battery percentage (0-100) or null if unavailable
 */
const resolveBatteryPercentFromVehicleInfo = (vehicleInfo: unknown) => {
  // Ensure we have a valid object
  if (!vehicleInfo || typeof vehicleInfo !== "object") {
    return null;
  }

  // Extract batteryPercent field
  const rawPercent = (vehicleInfo as { batteryPercent?: unknown })
    .batteryPercent;
  
  // Validate it's a finite number
  if (typeof rawPercent !== "number" || !Number.isFinite(rawPercent)) {
    return null;
  }

  // Normalize to 0-100 range
  return clampBatteryPercent(rawPercent);
};

/**
 * Determines the starting battery percentage for a charging session.
 * 
 * Priority:
 * 1. Explicitly stored startingBatteryPercent in ticket
 * 2. Current battery level from vehicle info
 * 
 * @param snapshot - Ticket snapshot data
 * @param vehicleInfo - Vehicle information (optional)
 * @returns Starting battery percentage or null
 */
const resolveStartingBatteryPercent = (
  snapshot: Record<string, unknown>,
  vehicleInfo?: Record<string, unknown> | null
) => {
  // First, check if ticket has explicit starting percentage
  const rawStartingPercent = (snapshot as { startingBatteryPercent?: unknown })
    .startingBatteryPercent;
  
  if (
    typeof rawStartingPercent === "number" &&
    Number.isFinite(rawStartingPercent)
  ) {
    // Use the stored starting percentage (clamped to 0-100)
    return clampBatteryPercent(rawStartingPercent);
  }

  // Otherwise, get current battery from vehicle
  return resolveBatteryPercentFromVehicleInfo(
    vehicleInfo ?? (snapshot as { vehicleInfo?: unknown }).vehicleInfo
  );
};

/**
 * Calculates target battery percentage for charging session.
 * 
 * Priority:
 * 1. Explicitly set targetBatteryPercent in ticket
 * 2. Calculate from ticketKwh + vehicle battery capacity
 * 3. Return null if can't determine
 * 
 * @param snapshot - Ticket snapshot data
 * @param startingBatteryPercent - Starting battery level
 * @param vehicleInfo - Vehicle information (optional)
 * @returns Target battery percentage or null
 * 
 * @example
 * // Ticket has 20 kWh, vehicle has 75 kWh capacity, starting at 30%
 * // 20/75 = 26.67% → target = 30% + 26.67% = 56.67% ≈ 57%
 */
const resolveTargetBatteryPercent = (
  snapshot: Record<string, unknown>,
  startingBatteryPercent: number | null,
  vehicleInfo?: Record<string, unknown> | null
) => {
  // Can't calculate without a starting point
  if (startingBatteryPercent === null) {
    return null;
  }

  // Check if ticket has explicit target
  const rawTarget = (snapshot as { targetBatteryPercent?: unknown })
    .targetBatteryPercent;
  
  if (typeof rawTarget === "number" && Number.isFinite(rawTarget)) {
    // Use the explicit target (clamped to 0-100)
    return clampBatteryPercent(rawTarget);
  }

  // Calculate from ticketKwh if available
  const ticketKwh = resolveTicketKwh(
    (snapshot as { ticketKwh?: unknown }).ticketKwh
  );
  
  // Need both ticketKwh and battery capacity to calculate
  if (ticketKwh === null) {
    return null;
  }

  // Get vehicle battery capacity
  const capacity = resolveBatteryCapacityFromInfo(
    vehicleInfo ?? (snapshot as { vehicleInfo?: unknown }).vehicleInfo
  );
  
  if (capacity === null) {
    return null;
  }

  // Calculate: starting % + (kWh to add / total capacity × 100)
  // Example: 30% + (20 kWh / 75 kWh × 100) = 30% + 26.67% = 56.67%
  const percentFromKwh = (ticketKwh / capacity) * 100;
  return clampBatteryPercent(startingBatteryPercent + percentFromKwh);
};

/**
 * Appends current battery percentage to ticket snapshot based on charging progress.
 * 
 * @param snapshot - Ticket snapshot data
 * @param progressPercent - Current charging progress (0-100)
 * @param vehicleInfo - Vehicle information (optional)
 * @returns Snapshot with batteryPercentage field added
 */
export const appendChargingBatteryPercentage = <
  T extends Record<string, unknown>
>(
  snapshot: T,
  progressPercent: number | null | undefined,
  vehicleInfo?: Record<string, unknown> | null
): T & { batteryPercentage?: number } => {
  // Can't calculate without valid progress
  if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) {
    return snapshot;
  }

  // Get starting battery level
  const startingBatteryPercent = resolveStartingBatteryPercent(
    snapshot,
    vehicleInfo
  );

  // Can't calculate without starting point
  if (startingBatteryPercent === null) {
    return snapshot;
  }

  // Get target battery level
  const targetBatteryPercent = resolveTargetBatteryPercent(
    snapshot,
    startingBatteryPercent,
    vehicleInfo
  );

  // Add current battery percentage to snapshot
  return {
    ...snapshot,
    batteryPercentage: calculateChargingBatteryPercentage(
      progressPercent,
      startingBatteryPercent,
      targetBatteryPercent ?? 100 // Default to 100% if no target
    ),
  };
};

// ============================================================================
// HELPER FUNCTIONS - Data Conversion & ID Resolution
// ============================================================================

/**
 * Converts a Mongoose document to a plain JavaScript object.
 * 
 * @param doc - Mongoose document or plain object
 * @returns Plain object with getters applied
 */
const toSnapshot = (doc: any): Record<string, unknown> => {
  // Handle null/undefined
  if (!doc) {
    return {};
  }

  // If it's a Mongoose document, convert with getters
  // Otherwise just spread into new object
  return doc.toObject ? doc.toObject({ getters: true }) : { ...doc };
};

/**
 * Extracts ID string from various formats (string, object, ObjectId).
 * 
 * Handles multiple formats:
 * - Plain string ID
 * - Object with .id property
 * - Object with ._id property
 * - MongoDB ObjectId (with toString())
 * 
 * @param value - Value that might contain an ID
 * @returns ID as string or null if can't extract
 * 
 * @example
 * resolveId("abc123") → "abc123"
 * resolveId({id: "abc123"}) → "abc123"
 * resolveId(mongoObjectId) → "abc123"
 */
const resolveId = (value: any): string | null => {
  // Null or undefined
  if (!value) {
    return null;
  }

  // Already a string
  if (typeof value === "string") {
    return value;
  }

  // Check if it's an object with ID properties
  if (typeof value === "object") {
    // Try .id property first
    if (typeof value.id === "string") {
      return value.id;
    }

    // Try ._id as string
    if (typeof value._id === "string") {
      return value._id;
    }

    // Try ._id with toString() (MongoDB ObjectId)
    if (value._id?.toString) {
      return value._id.toString();
    }

    // Try toString() on the value itself
    if (value.toString) {
      const stringified = value.toString();
      // Avoid returning generic "[object Object]"
      return stringified === "[object Object]" ? null : stringified;
    }
  }

  return null;
};

// ============================================================================
// DATABASE OPERATIONS - Fetch & Update Data
// ============================================================================

/**
 * Updates a vehicle's battery percentage in the database.
 * 
 * Also updates:
 * - Battery status (LOW, MEDIUM, GOOD, FULL)
 * - lastBatteryUpdatedAt timestamp
 * 
 * @param vehicleId - Vehicle ID to update
 * @param batteryPercent - New battery percentage (0-100)
 * @param session - Optional MongoDB session for transactions
 * @returns Result object with ok status
 */
export const updateVehicleBatteryPercentage = async (
  vehicleId: unknown,
  batteryPercent: number | null | undefined,
  session?: mongoose.ClientSession
) => {
  // Extract ID from various formats
  const resolvedVehicleId = resolveId(vehicleId);
  
  // Validate inputs
  if (
    !resolvedVehicleId ||
    typeof batteryPercent !== "number" ||
    !Number.isFinite(batteryPercent)
  ) {
    return { ok: false };
  }

  // Normalize battery to 0-100 and calculate status
  const normalizedPercent = clampBatteryPercent(batteryPercent);
  const batteryStatus = calculateBatteryStatus(normalizedPercent);
  
  // Include session in options if provided (for transactions)
  const options = session ? { session } : undefined;
  
  // Update vehicle document
  const result = await Vehicle.updateOne(
    { _id: resolvedVehicleId },
    {
      $set: {
        batteryPercent: normalizedPercent,
        batteryStatus,
        lastBatteryUpdatedAt: new Date(),
      },
    },
    options
  );

  // Return success if vehicle was found and updated
  return { ok: result.matchedCount > 0, batteryPercent: normalizedPercent };
};

/**
 * Fetches station information from database.
 * 
 * @param stationId - Station ID to fetch
 * @returns Station data object or null if not found
 */
const fetchStationSnapshot = async (
  stationId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!stationId) {
    return null;
  }

  try {
    const station = await Station.findById(stationId);
    return station ? station.toObject({ getters: true }) : null;
  } catch (err) {
    // Return null on error (station not found or DB error)
    return null;
  }
};

/**
 * Fetches user's currently active vehicle from database.
 * 
 * @param userId - User ID to fetch active vehicle for
 * @returns Active vehicle data or null if none found
 */
const fetchActiveVehicleSnapshot = async (
  userId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!userId) {
    return null;
  }

  try {
    // Find vehicle marked as active for this user
    const vehicle = await Vehicle.findOne({ owner: userId, active: true }).sort({
      _id: -1, // Get most recent if multiple somehow active
    });
    return vehicle ? vehicle.toObject({ getters: true }) : null;
  } catch (err) {
    return null;
  }
};

/**
 * Fetches specific vehicle information from database.
 * 
 * @param vehicleId - Vehicle ID to fetch
 * @returns Vehicle data object or null if not found
 */
const fetchVehicleSnapshot = async (
  vehicleId: string | null
): Promise<Record<string, unknown> | null> => {
  if (!vehicleId) {
    return null;
  }

  try {
    const vehicle = await Vehicle.findById(vehicleId);
    return vehicle ? vehicle.toObject({ getters: true }) : null;
  } catch (err) {
    return null;
  }
};

// ============================================================================
// CHARGING DURATION RESOLUTION - Calculate Expected Charging Time
// ============================================================================

/**
 * Calculates charging duration from a ticket snapshot.
 * 
 * Priority:
 * 1. Use explicit chargingDurationMs if available
 * 2. Calculate from battery levels and charging speed
 * 3. Use max duration for charging speed
 * 
 * @param snapshot - Ticket snapshot data
 * @param vehicleInfo - Vehicle information (optional)
 * @returns Duration in milliseconds
 */
export const resolveChargingDurationMsFromSnapshot = (
  snapshot: Record<string, unknown>,
  vehicleInfo?: Record<string, unknown> | null
) => {
  // Check if duration is already calculated and stored
  const rawDuration = snapshot.chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration); // Ensure non-negative
  }

  // Calculate duration from battery levels
  const batteryPercent = resolveStartingBatteryPercent(snapshot, vehicleInfo);
  const targetBatteryPercent = resolveTargetBatteryPercent(
    snapshot,
    batteryPercent,
    vehicleInfo
  );
  const chargingSpeed = resolveChargingSpeed(snapshot.chargingSpeed);

  // If we have battery info, calculate precise duration
  if (batteryPercent !== null) {
    return calculateChargingDurationMs(
      batteryPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  }

  // Fallback to max duration for this charging speed
  return getMaxChargingDurationMs(chargingSpeed);
};

/**
 * Resolves charging duration for a ticket, fetching vehicle data if needed.
 * 
 * This is used when we have a ticket document (from DB) and need to determine
 * how long charging will take. May query database for vehicle battery info.
 * 
 * Priority:
 * 1. Use explicit chargingDurationMs from ticket
 * 2. Calculate from ticket's startingBatteryPercent
 * 3. Fetch vehicle data and calculate
 * 4. Use max duration for charging speed
 * 
 * @param ticket - Charging ticket document (Mongoose or plain object)
 * @returns Promise resolving to duration in milliseconds
 */
export const resolveChargingDurationMsForTicket = async (ticket: any) => {
  // Handle null/undefined ticket
  if (!ticket) {
    return CHARGING_DURATION_MS;
  }

  // Check if duration is already calculated
  const rawDuration = ticket.chargingDurationMs;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    return Math.max(0, rawDuration);
  }

  // Get charging speed for this ticket
  const chargingSpeed = resolveChargingSpeed(ticket.chargingSpeed);

  // Try to use stored starting battery percentage
  const rawStartingPercent = ticket.startingBatteryPercent;
  if (
    typeof rawStartingPercent === "number" &&
    Number.isFinite(rawStartingPercent)
  ) {
    // Calculate target and duration
    const targetBatteryPercent = resolveTargetBatteryPercent(
      ticket,
      rawStartingPercent,
      null
    );
    return calculateChargingDurationMs(
      rawStartingPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  }

  // Need to fetch vehicle battery info from database
  const vehicleId = resolveId(ticket.vehicle);
  if (!vehicleId) {
    // No vehicle info available, use default duration
    return CHARGING_DURATION_MS;
  }

  try {
    // Fetch only battery-related fields (optimization)
    const vehicle = await Vehicle.findById(vehicleId, {
      batteryPercent: 1,
      batteryCapacity: 1,
    }).lean(); // .lean() returns plain object (faster than Mongoose document)
    
    // Check if vehicle exists and has battery percentage
    if (!vehicle || typeof vehicle.batteryPercent !== "number") {
      return getMaxChargingDurationMs(chargingSpeed);
    }
    
    // Calculate target and duration using vehicle data
    const targetBatteryPercent = resolveTargetBatteryPercent(
      ticket,
      vehicle.batteryPercent,
      vehicle as Record<string, unknown>
    );
    return calculateChargingDurationMs(
      vehicle.batteryPercent,
      chargingSpeed,
      targetBatteryPercent
    );
  } catch (err) {
    // On error, fallback to max duration
    return getMaxChargingDurationMs(chargingSpeed);
  }
};

/**
 * Builds a complete charging ticket payload with all related information.
 * 
 * This hydrates a ticket with:
 * - Station information
 * - Vehicle information (with refreshed battery data)
 * - Calculated charging duration
 * - Estimated completion time
 * - Current battery percentage
 * 
 * Used when sending ticket data to the client.
 * 
 * @param ticket - Charging ticket document
 * @param options - Optional userId and stationId for optimization
 * @returns Promise resolving to enriched ticket payload
 * 
 * @example
 * const payload = await buildChargingTicketPayload(ticket);
 * // Returns:
 * // {
 * //   ...ticketData,
 * //   stationInfo: { name: "Station A", ... },
 * //   vehicleInfo: { model: "Tesla Model 3", batteryPercent: 45, ... },
 * //   chargingDurationMs: 150000,
 * //   estimatedCompletionAt: Date,
 * //   batteryPercentage: 47 // current battery during charging
 * // }
 */
export const buildChargingTicketPayload = async (
  ticket: any,
  options: { userId?: string; stationId?: string } = {}
) => {
  // Handle null ticket
  if (!ticket) {
    return null;
  }

  // Convert ticket to plain object
  let ticketSnapshot = toSnapshot(ticket);
  
  // Extract start time (might be in ticket or snapshot)
  const startedAtValue =
    ticket.startedAt ?? (ticketSnapshot as { startedAt?: unknown }).startedAt;
  const startedAt = startedAtValue ? new Date(startedAtValue as Date) : null;

  // Extract IDs (use provided options or extract from ticket)
  const userId = options.userId ?? resolveId(ticket.user);
  const stationId = options.stationId ?? resolveId(ticket.station);
  const ticketVehicleId = resolveId(ticket.vehicle);

  // Fetch station and vehicle data in parallel (optimization)
  const [stationInfo, vehicleInfo] = await Promise.all([
    fetchStationSnapshot(stationId),
    // Use specific vehicle if ticket has one, otherwise use user's active vehicle
    ticketVehicleId
      ? fetchVehicleSnapshot(ticketVehicleId)
      : fetchActiveVehicleSnapshot(userId),
  ]);
  
  // Refresh vehicle battery data (updates from any active charging)
  const hydratedVehicleInfo = await refreshVehicleBatterySnapshot(vehicleInfo);
  
  // Calculate charging duration
  const durationMs = resolveChargingDurationMsFromSnapshot(
    ticketSnapshot,
    hydratedVehicleInfo
  );
  
  // Add duration to ticket
  ticketSnapshot = {
    ...ticketSnapshot,
    chargingDurationMs: durationMs,
  };
  
  // Add estimated completion time
  ticketSnapshot = appendChargingEstimate(ticketSnapshot, startedAt, durationMs);
  
  // Add current battery percentage (interpolated from progress)
  ticketSnapshot = appendChargingBatteryPercentage(
    ticketSnapshot,
    typeof ticketSnapshot.progressPercent === "number"
      ? ticketSnapshot.progressPercent
      : null,
    hydratedVehicleInfo
  );

  // Return enriched ticket with all related info
  return {
    ...ticketSnapshot,
    stationInfo,
    vehicleInfo: hydratedVehicleInfo,
  };
};

export type VehicleChargingStatus = "IDLE" | "CHARGING";

export const setVehicleChargingStatus = async (
  vehicleId: string,
  chargingStatus: VehicleChargingStatus,
  session?: mongoose.ClientSession
) => {
  if (!vehicleId) {
    return { ok: false };
  }

  const options = session ? { session } : undefined;
  const result = await Vehicle.updateOne(
    { _id: vehicleId },
    { $set: { chargingStatus, lastBatteryUpdatedAt: new Date() } },
    options
  );

  return { ok: result.matchedCount > 0 };
};

export const setActiveVehicleChargingStatus = async (
  userId: string,
  chargingStatus: VehicleChargingStatus,
  session?: mongoose.ClientSession
) => {
  if (!userId) {
    return { ok: false };
  }

  const options = session ? { session } : undefined;
  const result = await Vehicle.updateOne(
    { owner: userId, active: true },
    { $set: { chargingStatus, lastBatteryUpdatedAt: new Date() } },
    options
  );

  return { ok: result.matchedCount > 0 };
};

export const clearChargingStatusForUserVehicles = async (
  userId: string,
  session?: mongoose.ClientSession
) => {
  if (!userId) {
    return;
  }

  const options = session ? { session } : undefined;
  await Vehicle.updateMany(
    { owner: userId, chargingStatus: "CHARGING" },
    { $set: { chargingStatus: "IDLE", lastBatteryUpdatedAt: new Date() } },
    options
  );
};

type AdjustAvailabilityResult = {
  ok: boolean;
  reason?: "no_available_ports" | "not_found";
};

export const adjustStationConnectorAvailability = async (
  stationId: string,
  connectorType: string,
  delta: number,
  session?: mongoose.ClientSession
): Promise<AdjustAvailabilityResult> => {
  if (!stationId || !connectorType || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, reason: "not_found" };
  }

  const query: Record<string, unknown> = {
    _id: stationId,
    "connectors.type": connectorType,
  };

  if (delta < 0) {
    query["connectors.availablePorts"] = { $gt: 0 };
  }

  const options = session ? { session } : undefined;
  const result = await Station.updateOne(
    query,
    { $inc: { "connectors.$.availablePorts": delta } },
    options
  );

  if (result.matchedCount === 0) {
    return { ok: false, reason: delta < 0 ? "no_available_ports" : "not_found" };
  }

  return { ok: true };
};

export const finalizeChargingTicket = async (
  ticketId: string,
  userId: string
) => {
  const sess = await mongoose.startSession();
  sess.startTransaction();

  try {
    const deletedTicket = await ChargingTicket.findOneAndDelete({
      _id: ticketId,
    }).session(sess);

    await User.updateOne(
      { _id: userId },
      { $pull: { tickets: ticketId } },
      { session: sess }
    );

    if (deletedTicket?.connectorType) {
      const stationId = resolveId(deletedTicket.station);
      if (stationId) {
        await adjustStationConnectorAvailability(
          stationId,
          deletedTicket.connectorType,
          1,
          sess
        );
      }
    }

    if (deletedTicket?.vehicle) {
      const vehicleId = resolveId(deletedTicket.vehicle);
      if (vehicleId) {
        await setVehicleChargingStatus(vehicleId, "IDLE", sess);
      }
    } else {
      await clearChargingStatusForUserVehicles(userId, sess);
    }

    await sess.commitTransaction();
  } catch (err) {
    await sess.abortTransaction();
    throw err;
  } finally {
    sess.endSession();
  }
};
