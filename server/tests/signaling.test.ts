import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";
import { RATE_LIMIT_MAX, SessionStore, UNUSED_TTL_MS } from "@familyguide/shared/session";
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
  vi.restoreAllMocks();
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

  it("a stale socket holding a reused code cannot signal into or tear down the new session", async () => {
    // Deterministic collision: every generated digit is 7, so every code is "777777".
    vi.spyOn(crypto, "randomInt").mockImplementation((() => 7) as never);

    const { elder: staleElder, code: staleCode } = await createSession();
    expect(staleCode).toBe("777777");

    // No helper joins; the code expires in the store while the elder socket stays open.
    clock += UNUSED_TTL_MS + 1;

    const { elder, code } = await createSession();
    expect(code).toBe(staleCode);
    const helper = await connect();
    helper.send({ type: "join", code });
    expect(await helper.next()).toEqual({ type: "joined", role: "helper" });
    expect(await elder.next()).toEqual({ type: "peer-joined" });

    // Stale elder tries to inject a signal, then disconnects.
    if (staleElder.ws.readyState === WebSocket.OPEN) {
      staleElder.send({ type: "signal", payload: "injected" });
      staleElder.send({ type: "hangup" });
    }
    staleElder.ws.close();
    await staleElder.closed;
    expect(staleElder.received).toContainEqual({ type: "error", code: "expired" });

    // Give a wrongful teardown a chance to happen, then assert it did not.
    await Promise.race([
      Promise.all([elder.closed, helper.closed]),
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
    expect(elder.received).not.toContainEqual({ type: "signal", payload: "injected" });
    expect(elder.received).not.toContainEqual({ type: "peer-left" });
    expect(helper.received).not.toContainEqual({ type: "peer-left" });
    expect(elder.ws.readyState).toBe(WebSocket.OPEN);
    expect(helper.ws.readyState).toBe(WebSocket.OPEN);

    // Round-trip on the new session so anything routed from the stale socket would have arrived.
    elder.send({ type: "signal", payload: "ping" });
    expect(await helper.next()).toEqual({ type: "signal", payload: "ping" });
    helper.send({ type: "signal", payload: "pong" });
    expect(await elder.next()).toEqual({ type: "signal", payload: "pong" });

    expect(elder.received).toEqual([
      { type: "created", code },
      { type: "peer-joined" },
      { type: "signal", payload: "pong" },
    ]);
    expect(helper.received).toEqual([
      { type: "joined", role: "helper" },
      { type: "signal", payload: "ping" },
    ]);
    expect(elder.ws.readyState).toBe(WebSocket.OPEN);
    expect(helper.ws.readyState).toBe(WebSocket.OPEN);

    // The new session is still valid in the store.
    const third = await connect();
    third.send({ type: "join", code });
    expect(await third.next()).toEqual({ type: "error", code: "already_joined" });
  });
});

describe("attachSignaling unused-code expiry timer", () => {
  async function withTtlServer(
    ttlMs: number,
    run: (connectTo: () => Promise<Client>) => Promise<void>,
  ): Promise<void> {
    const s = http.createServer();
    const w = attachSignaling(s, new SessionStore(), { unusedTtlMs: ttlMs });
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const savedPort = port;
    port = (s.address() as AddressInfo).port;
    try {
      await run(connect);
    } finally {
      port = savedPort;
      for (const c of clients) c.ws.terminate();
      await new Promise<void>((resolve) => w.close(() => resolve()));
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }

  it("tells the elder the code expired, closes the connection, and the code no longer joins", async () => {
    await withTtlServer(80, async () => {
      const { elder, code } = await createSession();
      expect(await elder.next()).toEqual({ type: "error", code: "expired" });
      await elder.closed;

      const helper = await connect();
      helper.send({ type: "join", code });
      const reply = await helper.next();
      expect(reply.type).toBe("error");
      expect(elder.received).toEqual([{ type: "created", code }, { type: "error", code: "expired" }]);
    });
  });

  it("does not fire once a helper has joined", async () => {
    await withTtlServer(80, async () => {
      const { elder, code } = await createSession();
      const helper = await connect();
      helper.send({ type: "join", code });
      expect(await helper.next()).toEqual({ type: "joined", role: "helper" });
      expect(await elder.next()).toEqual({ type: "peer-joined" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(elder.received).not.toContainEqual({ type: "error", code: "expired" });
      expect(elder.ws.readyState).toBe(WebSocket.OPEN);
      expect(helper.ws.readyState).toBe(WebSocket.OPEN);
    });
  });

  it("a stale room's timer cannot end a newer session that reused the code", async () => {
    vi.spyOn(crypto, "randomInt").mockImplementation((() => 4) as never);
    await withTtlServer(150, async () => {
      const { elder: first, code } = await createSession();
      expect(code).toBe("444444");
      // The first elder hangs up before its timer fires; the code is reused at once.
      first.send({ type: "hangup" });
      await first.closed;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const { elder: second, code: again } = await createSession();
      expect(again).toBe(code);
      // Past the first room's deadline, before the second's.
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(second.received).toEqual([{ type: "created", code }]);
      expect(second.ws.readyState).toBe(WebSocket.OPEN);
      const helper = await connect();
      helper.send({ type: "join", code });
      expect(await helper.next()).toEqual({ type: "joined", role: "helper" });
    });
  });
});

describe("attachSignaling failed joins per connection", () => {
  it(`closes a connection after ${RATE_LIMIT_MAX} failed joins on it`, async () => {
    // Fresh client ids each time would bypass the per-client window; the per-connection cap still holds.
    const helper = await connect();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      helper.send({ type: "join", code: "000000" });
      const reply = await helper.next();
      expect(reply.type).toBe("error");
    }
    await helper.closed;
    expect(helper.ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("keeps the connection open below the cap", async () => {
    const helper = await connect();
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
      helper.send({ type: "join", code: "000000" });
      await helper.next();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(helper.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("attachSignaling failed-join reset", () => {
  it("does not reset failures when the joiner has the creator's client id (same address)", async () => {
    // Every test client is 127.0.0.1, so the elder and helper share a client id.
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
      const probe = await connect();
      probe.send({ type: "join", code: "000000" });
      expect((await probe.next()).type).toBe("error");
    }
    const { code } = await createSession();
    const helper = await connect();
    helper.send({ type: "join", code });
    expect(await helper.next()).toEqual({ type: "joined", role: "helper" });

    const bad = code === "000000" ? "111111" : "000000";
    const a = await connect();
    a.send({ type: "join", code: bad });
    expect(await a.next()).toEqual({ type: "error", code: "invalid" });
    const b = await connect();
    b.send({ type: "join", code: bad });
    expect(await b.next()).toEqual({ type: "error", code: "rate_limited" });
  });
});

describe("attachSignaling clientId and X-Forwarded-For", () => {
  async function withServer(
    opts: { trustProxy?: boolean } | undefined,
    run: (join: (headers: Record<string, string>) => Promise<WsServerMessage>) => Promise<void>,
  ): Promise<void> {
    const s = http.createServer();
    const w = attachSignaling(s, new SessionStore(), opts);
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const p = (s.address() as AddressInfo).port;
    const opened: WebSocket[] = [];
    const join = (headers: Record<string, string>) =>
      new Promise<WsServerMessage>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { headers });
        opened.push(ws);
        ws.once("error", reject);
        ws.once("message", (d) => resolve(JSON.parse(String(d)) as WsServerMessage));
        ws.once("open", () => ws.send(JSON.stringify({ type: "join", code: "000000" })));
      });
    try {
      await run(join);
    } finally {
      for (const ws of opened) ws.terminate();
      await new Promise<void>((resolve) => w.close(() => resolve()));
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }

  const xff = (v: string) => ({ "x-forwarded-for": v });

  it("by default ignores a spoofed X-Forwarded-For and CF-Connecting-IP for the join rate limit", async () => {
    await withServer(undefined, async (join) => {
      for (let i = 0; i < 10; i++) {
        expect(await join({ ...xff(`10.0.0.${i}`), "cf-connecting-ip": `10.1.0.${i}` })).toEqual({
          type: "error",
          code: "invalid",
        });
      }
      expect(await join(xff("10.0.0.99"))).toEqual({ type: "error", code: "rate_limited" });
    });
  });

  it("with trustProxy uses the rightmost forwarded address (added by the proxy), not the spoofable leftmost", async () => {
    await withServer({ trustProxy: true }, async (join) => {
      for (let i = 0; i < 10; i++) {
        // The client varies the leftmost entry; the proxy appends the real address.
        expect(await join(xff(`6.6.6.${i}, 10.0.0.1`))).toEqual({ type: "error", code: "invalid" });
      }
      expect(await join(xff("7.7.7.7, 10.0.0.1"))).toEqual({ type: "error", code: "rate_limited" });
      expect(await join(xff("10.0.0.1, 10.0.0.2"))).toEqual({ type: "error", code: "invalid" });
    });
  });

  it("with trustProxy prefers CF-Connecting-IP over X-Forwarded-For", async () => {
    await withServer({ trustProxy: true }, async (join) => {
      for (let i = 0; i < 10; i++) {
        expect(await join({ ...xff(`10.0.0.${i}`), "cf-connecting-ip": "203.0.113.5" })).toEqual({
          type: "error",
          code: "invalid",
        });
      }
      expect(await join({ ...xff("10.0.0.50"), "cf-connecting-ip": "203.0.113.5" })).toEqual({
        type: "error",
        code: "rate_limited",
      });
      expect(await join({ ...xff("10.0.0.50"), "cf-connecting-ip": "203.0.113.6" })).toEqual({
        type: "error",
        code: "invalid",
      });
    });
  });
});
