import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";
import { SessionStore } from "@familyguide/shared/session";
import type { WsServerMessage } from "@familyguide/shared";
import { attachSignaling } from "../src/signaling.ts";

type Client = {
  ws: WebSocket;
  next: () => Promise<WsServerMessage>;
  received: WsServerMessage[];
  closed: Promise<void>;
  send: (msg: unknown) => void;
};

let server: http.Server;
let wss: WebSocketServer;
let port: number;
let clients: Client[];
let clock: number;

function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: WsServerMessage[] = [];
  const waiters: Array<(m: WsServerMessage) => void> = [];
  let read = 0;
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as WsServerMessage;
    received.push(msg);
    const w = waiters.shift();
    if (w) {
      read++;
      w(msg);
    }
  });
  const closed = new Promise<void>((resolve) => ws.on("close", () => resolve()));
  const client: Client = {
    ws,
    received,
    closed,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: () =>
      new Promise((resolve) => {
        if (read < received.length) {
          resolve(received[read++]);
        } else {
          waiters.push(resolve);
        }
      }),
  };
  clients.push(client);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
    ws.once("error", reject);
  });
}

async function createSession(): Promise<{ elder: Client; code: string }> {
  const elder = await connect();
  elder.send({ type: "create" });
  const msg = await elder.next();
  if (msg.type !== "created") throw new Error(`expected created, got ${msg.type}`);
  return { elder, code: msg.code };
}

beforeEach(async () => {
  clients = [];
  clock = 1_000_000;
  const store = new SessionStore({ now: () => clock });
  server = http.createServer();
  wss = attachSignaling(server, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("attachSignaling", () => {
  it("create returns a 6-digit code; join notifies helper and elder", async () => {
    const { elder, code } = await createSession();
    expect(code).toMatch(/^\d{6}$/);

    const helper = await connect();
    helper.send({ type: "join", code });
    expect(await helper.next()).toEqual({ type: "joined", role: "helper" });
    expect(await elder.next()).toEqual({ type: "peer-joined" });
  });

  it("join with a wrong code returns error invalid", async () => {
    const { code } = await createSession();
    const wrong = code === "000000" ? "111111" : "000000";
    const helper = await connect();
    helper.send({ type: "join", code: wrong });
    expect(await helper.next()).toEqual({ type: "error", code: "invalid" });
  });

  it("after elder hangup the helper gets peer-left and the code is no longer usable", async () => {
    const { elder, code } = await createSession();
    const helper = await connect();
    helper.send({ type: "join", code });
    await helper.next();
    await elder.next();

    elder.send({ type: "hangup" });
    expect(await helper.next()).toEqual({ type: "peer-left" });
    await Promise.all([elder.closed, helper.closed]);

    const again = await connect();
    again.send({ type: "join", code });
    expect(await again.next()).toEqual({ type: "error", code: "invalid" });
  });

  it("signal from elder reaches only the helper with the same payload", async () => {
    const { elder, code } = await createSession();
    const helper = await connect();
    helper.send({ type: "join", code });
    await helper.next();
    await elder.next();

    const payload = { sdp: "offer-sdp", kind: "offer", nested: [1, 2] };
    elder.send({ type: "signal", payload });
    expect(await helper.next()).toEqual({ type: "signal", payload });

    // Round-trip a message so any echo to the elder would have arrived first.
    helper.send({ type: "signal", payload: "pong" });
    expect(await elder.next()).toEqual({ type: "signal", payload: "pong" });
    expect(elder.received.filter((m) => m.type === "signal")).toEqual([
      { type: "signal", payload: "pong" },
    ]);
  });

  it("a third connection joining after one helper gets already_joined", async () => {
    const { code } = await createSession();
    const helper = await connect();
    helper.send({ type: "join", code });
    await helper.next();

    const third = await connect();
    third.send({ type: "join", code });
    expect(await third.next()).toEqual({ type: "error", code: "already_joined" });
  });
});
