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

  function endRoom(code: string, from: WebSocket): void {
    const room = rooms.get(code);
    store.end(code);
    if (!room) return;
    rooms.delete(code);
    const other = room.elder === from ? room.helper : room.elder;
    send(other, { type: "peer-left" });
    room.elder.close();
    room.helper?.close();
  }

  wss.on("connection", (ws, req) => {
    const clientId = clientIdOf(req);
    let code: string | undefined;

    ws.on("message", (data) => {
      const msg = parseWsClientMessage(String(data));
      if (!msg) return;

      switch (msg.type) {
        case "create": {
          if (code) return;
          const session = store.create();
          code = session.code;
          rooms.set(code, { elder: ws });
          send(ws, { type: "created", code });
          return;
        }
        case "join": {
          if (code) return;
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
          code = msg.code;
          room.helper = ws;
          send(ws, { type: "joined", role: "helper" });
          send(room.elder, { type: "peer-joined" });
          return;
        }
        case "signal": {
          if (!code) return;
          const room = rooms.get(code);
          if (!room) return;
          const peer = room.elder === ws ? room.helper : room.elder;
          send(peer, { type: "signal", payload: msg.payload });
          return;
        }
        case "hangup": {
          if (code) endRoom(code, ws);
          return;
        }
      }
    });

    ws.on("close", () => {
      if (code) endRoom(code, ws);
    });
  });

  return wss;
}
