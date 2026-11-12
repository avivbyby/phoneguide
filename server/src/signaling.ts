import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { parseWsClientMessage } from "@familyguide/shared";
import type { WsServerMessage } from "@familyguide/shared";
import { RATE_LIMIT_MAX, SessionStore, UNUSED_TTL_MS } from "@familyguide/shared/session";
import type { JoinError } from "@familyguide/shared/session";

// `expiry` tells the elder when an unused code dies; cleared once a helper joins
// or the room ends.
type Room = { elder: WebSocket; helper?: WebSocket; expiry?: ReturnType<typeof setTimeout> };

function send(ws: WebSocket | undefined, msg: WsServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export type SignalingOptions = {
  // Take the client address (rate-limit bucket) from the proxy's headers: CF-Connecting-IP,
  // else the rightmost X-Forwarded-For entry (the one the proxy appended). Only enable
  // behind a known proxy: a direct client can set these headers to anything.
  // With it off, a local tunnel (cloudflared) makes every client 127.0.0.1, so all
  // helpers share one rate-limit bucket.
  trustProxy?: boolean;
  // How long an unused code lives before the elder is told it expired. Tests only.
  unusedTtlMs?: number;
};

// Signaling messages (SDP, ICE candidates) are a few KB at most.
const MAX_PAYLOAD_BYTES = 64 * 1024;

// Failed joins allowed on one WebSocket before it is closed. Extra to the
// per-client window in SessionStore, which a shared or changing address can dodge.
export const MAX_FAILED_JOINS_PER_CONNECTION = RATE_LIMIT_MAX;

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(",") : value;
}

function clientIdOf(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = headerValue(req, "cf-connecting-ip")?.trim();
    if (cf) return cf;
    // The leftmost entries come from the client and can be spoofed; the trusted
    // proxy appends the address it saw, so take the rightmost.
    const forwarded = headerValue(req, "x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = forwarded?.[forwarded.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

export function attachSignaling(
  server: HttpServer,
  store: SessionStore = new SessionStore(),
  opts: SignalingOptions = {},
): WebSocketServer {
  const trustProxy = opts.trustProxy ?? false;
  const unusedTtlMs = opts.unusedTtlMs ?? UNUSED_TTL_MS;
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<string, Room>();
  // Which session code each connection is bound to. `null` means the connection's
  // session has ended; it may not create, join, signal or hang up again.
  const bindings = new WeakMap<WebSocket, string | null>();

  function isMember(room: Room, ws: WebSocket): boolean {
    return room.elder === ws || room.helper === ws;
  }

  function clearExpiry(room: Room): void {
    if (room.expiry) clearTimeout(room.expiry);
    room.expiry = undefined;
  }

  // Bound to this room object: if the code was ended and reused, rooms.get(code)
  // is a different room and the timer does nothing.
  function startExpiry(code: string, room: Room): void {
    room.expiry = setTimeout(() => {
      room.expiry = undefined;
      if (rooms.get(code) !== room || room.helper) return;
      rooms.delete(code);
      store.end(code);
      unbind(room);
      send(room.elder, { type: "error", code: "expired" });
      room.elder.close();
    }, unusedTtlMs);
  }

  function unbind(room: Room): void {
    bindings.set(room.elder, null);
    if (room.helper) bindings.set(room.helper, null);
  }

  // The room this connection currently belongs to, or undefined if its binding is
  // stale (the code was ended, expired, or reused by a later session).
  function roomOf(ws: WebSocket): { code: string; room: Room } | undefined {
    const code = bindings.get(ws);
    if (!code) return undefined;
    const room = rooms.get(code);
    if (!room || !isMember(room, ws)) {
      bindings.set(ws, null);
      return undefined;
    }
    return { code, room };
  }

  function endRoom(from: WebSocket): void {
    const current = roomOf(from);
    if (!current) return;
    const { code, room } = current;
    clearExpiry(room);
    rooms.delete(code);
    store.end(code);
    unbind(room);
    const other = room.elder === from ? room.helper : room.elder;
    send(other, { type: "peer-left" });
    room.elder.close();
    room.helper?.close();
  }

  // The store expired this code and handed it out again; retire the old room
  // without touching the store entry, which now belongs to the new session.
  function evictStaleRoom(code: string, room: Room): void {
    clearExpiry(room);
    rooms.delete(code);
    unbind(room);
    send(room.elder, { type: "error", code: "expired" });
    send(room.helper, { type: "peer-left" });
    room.elder.close();
    room.helper?.close();
  }

  wss.on("connection", (ws, req) => {
    const clientId = clientIdOf(req, trustProxy);
    let failedJoins = 0;

    function joinFailed(code: JoinError): void {
      send(ws, { type: "error", code });
      failedJoins++;
      if (failedJoins >= MAX_FAILED_JOINS_PER_CONNECTION) ws.close();
    }

    ws.on("message", (data) => {
      const msg = parseWsClientMessage(String(data));
      if (!msg) return;

      switch (msg.type) {
        case "create": {
          if (bindings.has(ws)) return;
          const session = store.create(clientId);
          const code = session.code;
          const stale = rooms.get(code);
          if (stale) evictStaleRoom(code, stale);
          const room: Room = { elder: ws };
          rooms.set(code, room);
          bindings.set(ws, code);
          startExpiry(code, room);
          send(ws, { type: "created", code });
          return;
        }
        case "join": {
          if (bindings.has(ws)) return;
          const result = store.join(msg.code, clientId);
          if (!result.ok) {
            joinFailed(result.error);
            return;
          }
          const room = rooms.get(msg.code);
          if (!room) {
            store.end(msg.code);
            joinFailed("invalid");
            return;
          }
          clearExpiry(room);
          room.helper = ws;
          bindings.set(ws, msg.code);
          send(ws, { type: "joined", role: "helper" });
          send(room.elder, { type: "peer-joined" });
          return;
        }
        case "signal": {
          const current = roomOf(ws);
          if (!current) return;
          const { room } = current;
          const peer = room.elder === ws ? room.helper : room.elder;
          send(peer, { type: "signal", payload: msg.payload });
          return;
        }
        case "hangup": {
          endRoom(ws);
          return;
        }
      }
    });

    ws.on("close", () => {
      endRoom(ws);
    });
  });

  return wss;
}
