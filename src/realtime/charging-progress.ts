import type { IncomingMessage, Server as HttpServer } from "http";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";

import ChargingTicket from "../models/charging-ticket";
import {
  buildChargingTicketPayload,
  calculateChargingProgressPercent,
  finalizeChargingTicket,
} from "../services/charging-ticket-service";

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

const updateTicketProgressSnapshot = <T extends Record<string, unknown>>(
  snapshot: T,
  progressPercent: number
) => {
  return {
    ...snapshot,
    progressPercent,
    chargingStatus: "IN_PROGRESS" as const,
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

    let ticketSnapshot = initialSnapshot;

    const key = buildChargingProgressKey(userId, stationId);

    const tick = async () => {
      const progressPercent = calculateChargingProgressPercent(startedAt);

      if (progressPercent >= 100) {
        const completedAt = new Date();
        const completedTicket = {
          ...ticketSnapshot,
          progressPercent: 100,
          chargingStatus: "COMPLETED",
          completedAt,
        };

        try {
          await finalizeChargingTicket(ticketId, userId);
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

      broadcastChargingProgress(key, {
        type: "progress",
        ticket: ticketSnapshot,
      });
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
      const progressPercent = calculateChargingProgressPercent(
        activeTicket.startedAt
      );

      if (progressPercent >= 100) {
        const completedAt = new Date();
        const completedPayload = await buildChargingTicketPayload(activeTicket, {
          userId: user.id,
          stationId,
        });
        const completedTicket = {
          ...(completedPayload ?? activeTicket.toObject({ getters: true })),
          progressPercent: 100,
          chargingStatus: "COMPLETED",
          completedAt,
        };

        try {
          await finalizeChargingTicket(activeTicket.id, user.id);
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
