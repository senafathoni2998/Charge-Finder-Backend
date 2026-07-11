import type { IncomingMessage, Server as HttpServer } from "http";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";

import ChargingTicket from "../models/charging-ticket";
import {
  appendChargingBatteryPercentage,
  buildChargingTicketPayload,
  calculateChargingProgressPercent,
  finalizeChargingTicket,
  resolveChargingDurationMsForTicket,
  resolveChargingDurationMsFromSnapshot,
  updateVehicleBatteryPercentage,
} from "../services/charging-ticket-service";
import { recordChargingHistory } from "../services/charging-history-service";

type SubscriberKey = string;

const subscribers = new Map<SubscriberKey, Set<WebSocket>>();
const chargingTimers = new Map<string, NodeJS.Timeout>();

const CHARGING_PROGRESS_TICK_MS = 5000;

const addChargingProgressSubscriber = (key: SubscriberKey, ws: WebSocket) => {
  const existing = subscribers.get(key);
  if (existing) {
    existing.add(ws);
    return;
  }

  subscribers.set(key, new Set([ws]));
};

const removeChargingProgressSubscriber = (key: SubscriberKey, ws: WebSocket) => {
  const existing = subscribers.get(key);
  if (!existing) {
    return;
  }

  existing.delete(ws);
  if (existing.size === 0) {
    subscribers.delete(key);
  }
};

export const buildChargingProgressKey = (userId: string, stationId: string) => {
  return `${userId}:${stationId}`;
};

export const broadcastChargingProgress = (
  key: SubscriberKey,
  payload: unknown
) => {
  const existing = subscribers.get(key);
  if (!existing) {
    return;
  }

  const message = JSON.stringify(payload);
  for (const ws of existing) {
    if (ws.readyState !== WebSocket.OPEN) {
      existing.delete(ws);
      continue;
    }

    try {
      ws.send(message);
    } catch (err) {
      existing.delete(ws);
    }
  }

  if (existing.size === 0) {
    subscribers.delete(key);
  }
};

/**
 * True when a charging session with a "notify me at X%" threshold has reached it.
 * Pure so the crossing rule is unit-testable in isolation; the once-only guarantee
 * comes from the atomic DB claim at the call site, not from this predicate.
 */
export const shouldNotifyTargetReached = (
  notifyAtPercent: unknown,
  batteryPercentage: unknown,
  startingBatteryPercent?: unknown
): boolean =>
  typeof notifyAtPercent === "number" &&
  Number.isFinite(notifyAtPercent) &&
  notifyAtPercent > 0 &&
  typeof batteryPercentage === "number" &&
  Number.isFinite(batteryPercentage) &&
  batteryPercentage >= notifyAtPercent &&
  // Suppress the alert when the battery was ALREADY at/above the threshold when
  // charging started — it never "reached" the threshold during this session.
  !(
    typeof startingBatteryPercent === "number" &&
    Number.isFinite(startingBatteryPercent) &&
    startingBatteryPercent >= notifyAtPercent
  );

// Atomically claims and broadcasts a one-shot "target-reached" event when a session
// with a notify-at threshold has crossed it. The claim (notifyAtReachedAt null ->
// timestamp) guarantees exactly-once delivery across ticks, a reconnect-spawned
// timer, and the completion paths (all of which call this before the ticket is
// finalized/deleted).
const broadcastTargetReachedIfCrossed = async (
  ticketId: string,
  key: SubscriberKey,
  snapshot: Record<string, unknown>
): Promise<void> => {
  const notifyAtPercent = snapshot.notifyAtPercent;
  const batteryPercentage = snapshot.batteryPercentage;
  if (
    !shouldNotifyTargetReached(
      notifyAtPercent,
      batteryPercentage,
      snapshot.startingBatteryPercent
    )
  ) {
    return;
  }
  try {
    const claim = await ChargingTicket.updateOne(
      { _id: ticketId, notifyAtReachedAt: null, notifyAtPercent: { $gt: 0 } },
      { $set: { notifyAtReachedAt: new Date() } }
    );
    if (claim.modifiedCount === 1) {
      broadcastChargingProgress(key, {
        type: "target-reached",
        notifyAtPercent,
        batteryPercentage,
        ticket: snapshot,
      });
    }
  } catch (err) {
    // Non-fatal — a later tick retries the claim.
  }
};

const updateTicketProgressSnapshot = <T extends Record<string, unknown>>(
  snapshot: T,
  progressPercent: number
): T & {
  progressPercent: number;
  chargingStatus: "IN_PROGRESS";
  batteryPercentage?: number;
} => {
  const updatedSnapshot = {
    ...snapshot,
    progressPercent,
    chargingStatus: "IN_PROGRESS" as const,
  };

  return appendChargingBatteryPercentage(
    updatedSnapshot,
    progressPercent
  ) as T & {
    progressPercent: number;
    chargingStatus: "IN_PROGRESS";
    batteryPercentage?: number;
  };
};

export const clearChargingProgressTimer = (ticketId: string) => {
  const intervalId = chargingTimers.get(ticketId);
  if (!intervalId) {
    return;
  }

  clearInterval(intervalId);
  chargingTimers.delete(ticketId);
};

export const ensureChargingProgressTimer = (ticket: any) => {
  if (!ticket?.startedAt || ticket.chargingStatus !== "IN_PROGRESS") {
    return;
  }

  const ticketId = ticket._id?.toString?.() ?? ticket.id;
  const userId = ticket.user?.toString?.() ?? ticket.user?.id ?? ticket.user;
  const stationId =
    ticket.station?.toString?.() ?? ticket.station?.id ?? ticket.station;
  const vehicleId =
    ticket.vehicle?.toString?.() ?? ticket.vehicle?.id ?? ticket.vehicle;

  if (!ticketId || !userId || !stationId) {
    return;
  }

  if (chargingTimers.has(ticketId)) {
    return;
  }

  void (async () => {
    const startedAt = new Date(ticket.startedAt);
    const initialSnapshot = await buildChargingTicketPayload(ticket, {
      userId,
      stationId,
    });

    if (!initialSnapshot) {
      return;
    }

    let ticketSnapshot = initialSnapshot as Record<string, unknown>;
    const chargingDurationMs =
      resolveChargingDurationMsFromSnapshot(ticketSnapshot);

    const key = buildChargingProgressKey(userId, stationId);

    const tick = async () => {
      const progressPercent = calculateChargingProgressPercent(
        startedAt,
        Date.now(),
        chargingDurationMs
      );

      if (progressPercent >= 100) {
        const completedAt = new Date();
        const completedTicket = appendChargingBatteryPercentage(
          {
            ...ticketSnapshot,
            progressPercent: 100,
            chargingStatus: "COMPLETED",
            completedAt,
          },
          100
        );
        const completedBatteryPercentage = (
          completedTicket as { batteryPercentage?: number }
        ).batteryPercentage;

        try {
          // Fire a pending "target-reached" BEFORE finalizing (which deletes the
          // ticket) so a threshold crossed in the same tick as completion — common
          // for high thresholds / short charges — isn't silently dropped.
          await broadcastTargetReachedIfCrossed(ticketId, key, completedTicket);
          await finalizeChargingTicket(ticketId, userId);
          if (vehicleId && typeof completedBatteryPercentage === "number") {
            void updateVehicleBatteryPercentage(
              vehicleId,
              completedBatteryPercentage
            ).catch(() => {});
          }
          void recordChargingHistory({
            userId,
            ticketSnapshot: completedTicket,
            outcome: "COMPLETED",
            endedAt: completedAt,
          }).catch(() => {});
          broadcastChargingProgress(key, {
            type: "completed",
            ticket: null,
            completedTicket,
          });
          clearChargingProgressTimer(ticketId);
          return;
        } catch (err) {
          return;
        }
      }

      const previousProgressPercent =
        typeof ticketSnapshot.progressPercent === "number"
          ? ticketSnapshot.progressPercent
          : null;
      ticketSnapshot = updateTicketProgressSnapshot(
        ticketSnapshot,
        progressPercent
      );

      try {
        const result = await ChargingTicket.updateOne(
          { _id: ticketId },
          {
            $set: {
              chargingStatus: "IN_PROGRESS",
              progressPercent,
              startedAt,
            },
          }
        );

        if (result.matchedCount === 0) {
          clearChargingProgressTimer(ticketId);
          return;
        }
      } catch (err) {
        // Ignore transient failures; the next tick will retry.
      }

      const batteryPercentage = (
        ticketSnapshot as { batteryPercentage?: number }
      ).batteryPercentage;
      if (
        vehicleId &&
        typeof batteryPercentage === "number" &&
        previousProgressPercent !== progressPercent
      ) {
        void updateVehicleBatteryPercentage(
          vehicleId,
          batteryPercentage
        ).catch(() => {});
      }

      broadcastChargingProgress(key, {
        type: "progress",
        ticket: ticketSnapshot,
      });

      await broadcastTargetReachedIfCrossed(ticketId, key, ticketSnapshot);
    };

    const intervalId = setInterval(tick, CHARGING_PROGRESS_TICK_MS);
    chargingTimers.set(ticketId, intervalId);
    void tick();
  })();
};

const parseStationId = (request: IncomingMessage) => {
  const url = request.url ?? "";
  const parsed = new URL(url, "http://localhost");
  return parsed.searchParams.get("stationId");
};

const parseSessionUser = (request: IncomingMessage) => {
  return (request as IncomingMessage & { session?: { user?: { id: string } } })
    .session?.user;
};

export const initChargingProgressWebSocketServer = (
  server: HttpServer,
  sessionMiddleware: RequestHandler
) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/ws/charging-progress")) {
      socket.destroy();
      return;
    }

    const fakeRes = {
      getHeader: () => undefined,
      setHeader: () => {},
      end: () => {},
    } as any;

    sessionMiddleware(request as any, fakeRes, (err) => {
      if (err) {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }

      const user = parseSessionUser(request);
      const stationId = parseStationId(request);

      if (!user?.id || !stationId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, request);
      });
    });
  });

  wss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    const user = parseSessionUser(request);
    const stationId = parseStationId(request);

    if (!user?.id || !stationId) {
      ws.close(1008, "Unauthorized");
      return;
    }

    const key = buildChargingProgressKey(user.id, stationId);
    addChargingProgressSubscriber(key, ws);

    ws.on("close", () => {
      removeChargingProgressSubscriber(key, ws);
    });

    ws.on("error", () => {
      removeChargingProgressSubscriber(key, ws);
    });

    let activeTicket = null;
    try {
      activeTicket = await ChargingTicket.findOne({
        station: stationId,
        user: user.id,
        status: { $in: ["REQUESTED", "PAID"] },
      }).sort({ createdAt: -1 });
    } catch (err) {
      // If the initial fetch fails, still keep the socket open for updates.
    }

    if (
      activeTicket?.chargingStatus === "IN_PROGRESS" &&
      activeTicket.startedAt
    ) {
      const chargingDurationMs =
        await resolveChargingDurationMsForTicket(activeTicket);
      const progressPercent = calculateChargingProgressPercent(
        activeTicket.startedAt,
        Date.now(),
        chargingDurationMs
      );

      if (progressPercent >= 100) {
        const completedAt = new Date();
        const completedPayload = await buildChargingTicketPayload(activeTicket, {
          userId: user.id,
          stationId,
        });
        const completedTicket = appendChargingBatteryPercentage(
          {
            ...(completedPayload ?? activeTicket.toObject({ getters: true })),
            progressPercent: 100,
            chargingStatus: "COMPLETED",
            completedAt,
          },
          100
        );
        const ticketVehicleId =
          activeTicket.vehicle?.toString?.() ??
          activeTicket.vehicle?.id ??
          activeTicket.vehicle;
        const completedBatteryPercentage = (
          completedTicket as { batteryPercentage?: number }
        ).batteryPercentage;

        try {
          // Also deliver a pending "target-reached" on the reconnect-completion
          // recovery path, before the ticket is finalized/deleted.
          await broadcastTargetReachedIfCrossed(
            activeTicket.id,
            key,
            completedTicket as Record<string, unknown>
          );
          await finalizeChargingTicket(activeTicket.id, user.id);
          if (ticketVehicleId && typeof completedBatteryPercentage === "number") {
            void updateVehicleBatteryPercentage(
              ticketVehicleId,
              completedBatteryPercentage
            ).catch(() => {});
          }
          void recordChargingHistory({
            userId: user.id,
            ticketSnapshot: completedTicket,
            outcome: "COMPLETED",
            endedAt: completedAt,
          }).catch(() => {});
          activeTicket = null;
          broadcastChargingProgress(key, {
            type: "completed",
            ticket: null,
            completedTicket,
          });
        } catch (err) {
          // If completion fails, fall back to returning the ticket.
        }
      } else {
        activeTicket.progressPercent = progressPercent;
        ensureChargingProgressTimer(activeTicket);
      }
    }

    const initialTicket = activeTicket
      ? await buildChargingTicketPayload(activeTicket, {
          userId: user.id,
          stationId,
        })
      : null;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "initial",
          ticket: initialTicket,
        })
      );
    }
  });
};
