import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp, listenTls } from "../src/listen.ts";

let webRoot: string;
let servers: Array<http.Server | https.Server>;

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

async function listenPlain(app: http.Server): Promise<number> {
  servers.push(app);
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  return (app.address() as AddressInfo).port;
}

beforeEach(() => {
  servers = [];
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-web-"));
  fs.writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><h1>אני עוזר</h1>");
});

afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  fs.rmSync(webRoot, { recursive: true, force: true });
});

describe("createApp", () => {
  it("GET / returns 200 and index.html", async () => {
    const port = await listenPlain(createApp({ webRoot }));
    const res = await get(port, "/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("אני עוזר");
  });

  it("GET /ws over plain HTTP does not return the site file", async () => {
    const port = await listenPlain(createApp({ webRoot }));
    const res = await get(port, "/ws");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain("אני עוזר");
  });

  it("has no /recordings path", async () => {
    const port = await listenPlain(createApp({ webRoot }));
    const res = await get(port, "/recordings");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("אני עוזר");
  });

  it("does not serve files outside webRoot", async () => {
    const port = await listenPlain(createApp({ webRoot }));
    const res = await get(port, "/..%2f..%2fetc%2fpasswd");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("/ws accepts a WebSocket upgrade", async () => {
    const port = await listenPlain(createApp({ webRoot }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const created = new Promise<string>((resolve) => ws.once("message", (d) => resolve(String(d))));
    ws.send(JSON.stringify({ type: "create" }));
    expect(JSON.parse(await created).type).toBe("created");
    ws.terminate();
  });
});

describe("listenTls", () => {
  it("serves the site over HTTPS and returns its url", async () => {
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-cert-"));
    const certPath = path.join(certDir, "cert.pem");
    const keyPath = path.join(certDir, "key.pem");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath,
    ], { stdio: "ignore" });
    const cert = fs.readFileSync(certPath, "utf8");
    const key = fs.readFileSync(keyPath, "utf8");
    fs.rmSync(certDir, { recursive: true, force: true });

    const app = createApp({ webRoot });
    servers.push(app);
    const { url } = await listenTls(app, { cert, key, port: 0 });
    expect(url).toMatch(/^https:\/\/localhost:\d+$/);
    const port = Number(new URL(url).port);

    const body = await new Promise<string>((resolve, reject) => {
      https
        .get({ host: "127.0.0.1", port, path: "/", ca: cert, servername: "localhost" }, (res) => {
          let b = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve(b));
        })
        .on("error", reject);
    });
    expect(body).toContain("אני עוזר");

    const ws = new WebSocket(`wss://localhost:${port}/ws`, { ca: cert });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.terminate();
  });
});
