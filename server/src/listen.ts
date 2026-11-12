import fs from "node:fs/promises";
import http from "node:http";
import type { Server as HttpServer } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { attachSignaling } from "./signaling.ts";

export type AppOptions = {
  webRoot: string;
  // See SignalingOptions.trustProxy. Off by default.
  trustProxy?: boolean;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

// Resolve a URL path to a file inside webRoot, or undefined if it escapes it.
function resolveInRoot(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const rel = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  return file === root || file.startsWith(root + path.sep) ? file : undefined;
}

// Static files from webRoot over GET/HEAD; /ws is WebSocket-only. Nothing else:
// no recordings, no list of sessions.
export function createApp(opts: AppOptions): HttpServer {
  const root = path.resolve(opts.webRoot);
  const app = http.createServer(async (req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
    if (urlPath === "/ws") {
      sendText(res, 426, "Upgrade Required");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      sendText(res, 405, "Method Not Allowed");
      return;
    }
    const file = resolveInRoot(root, urlPath);
    if (!file) {
      sendText(res, 400, "Bad Request");
      return;
    }
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error("not a file");
      const body = await fs.readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": body.length,
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      sendText(res, 404, "Not Found");
    }
  });
  attachSignaling(app, undefined, { trustProxy: opts.trustProxy ?? false });
  return app;
}

// Serve `app` (from createApp) over HTTPS: the TLS server hands every request and
// WebSocket upgrade to `app`. Closing `app` closes the TLS listener.
export async function listenTls(
  app: HttpServer,
  opts: { cert: string; key: string; port: number },
): Promise<{ url: string }> {
  const tls = https.createServer({ cert: opts.cert, key: opts.key });
  tls.on("request", (req, res) => app.emit("request", req, res));
  tls.on("upgrade", (req, socket, head) => app.emit("upgrade", req, socket, head));
  app.close = ((cb?: (err?: Error) => void) => {
    tls.close(cb);
    return app;
  }) as HttpServer["close"];
  await new Promise<void>((resolve, reject) => {
    tls.once("error", reject);
    tls.listen(opts.port, () => {
      tls.off("error", reject);
      resolve();
    });
  });
  const { port } = tls.address() as AddressInfo;
  return { url: `https://localhost:${port}` };
}
