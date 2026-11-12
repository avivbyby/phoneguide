import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp, listenTls } from "./listen.ts";

export { attachSignaling } from "./signaling.ts";
export { createApp, listenTls } from "./listen.ts";

export const DEFAULT_PORT = 8443;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const webRoot = process.env.WEB_ROOT ?? path.join(repoRoot, "web/dist");
  const certFile = process.env.TLS_CERT ?? path.join(repoRoot, ".certs/localhost.pem");
  const keyFile = process.env.TLS_KEY ?? path.join(repoRoot, ".certs/localhost-key.pem");
  // Only behind a known proxy; otherwise clients could spoof the forwarding headers.
  // With it off, a local tunnel (cloudflared) makes every client 127.0.0.1, so all
  // helpers share one join rate-limit bucket. See SignalingOptions.trustProxy.
  const trustProxy = process.env.TRUST_PROXY === "1";

  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    console.error(`Missing TLS cert/key (${certFile}, ${keyFile}). Run scripts/dev.sh to create a local one.`);
    process.exit(1);
  }
  const app = createApp({ webRoot, trustProxy });
  const { url } = await listenTls(app, {
    cert: fs.readFileSync(certFile, "utf8"),
    key: fs.readFileSync(keyFile, "utf8"),
    port,
  });
  console.log(`Family phone guide: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
