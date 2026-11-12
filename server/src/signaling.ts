import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { parseWsClientMessage } from "@familyguide/shared";
import type { WsServerMessage } from "@familyguide/shared";
import { SessionStore } from "@familyguide/shared/session";

type Room = { elder: WebSocket; helper?: WebSocket };

function send(ws: WebSocket | undefined, msg: WsServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function clientIdOf(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "127.0.0.1";
}

export function attachSignaling(server: HttpServer, store: SessionStore = new SessionStore()): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const rooms = new Map<string, Room>();
  // Which session code each connection is bound to. `null` means the connection's
  // session has ended; it may not create, join, signal or hang up again.
  const bindings = new WeakMap<WebSocket, string | null>();

  function isMember(room: Room, ws: WebSocket): boolean {
    return room.elder === ws || room.helper === ws;
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
    rooms.delete(code);
    unbind(room);
    send(room.elder, { type: "error", code: "expired" });
    send(room.helper, { type: "peer-left" });
    room.elder.close();
    room.helper?.close();
  }

  wss.on("connection", (ws, req) => {
    const clientId = clientIdOf(req);

    ws.on("message", (data) => {
      const msg = parseWsClientMessage(String(data));
      if (!msg) return;

      switch (msg.type) {
        case "create": {
          if (bindings.has(ws)) return;
          const session = store.create();
          const code = session.code;
          const stale = rooms.get(code);
          if (stale) evictStaleRoom(code, stale);
          rooms.set(code, { elder: ws });
          bindings.set(ws, code);
          send(ws, { type: "created", code });
          return;
        }
        case "join": {
          if (bindings.has(ws)) return;
          const result = store.join(msg.code, clientId);
          if (!result.ok) {
            send(ws, { type: "error", code: result.error });
            return;
          }
          const room = rooms.get(msg.code);
          if (!room) {
            store.end(msg.code);
            send(ws, { type: "error", code: "invalid" });
            return;
          }
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
