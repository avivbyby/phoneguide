#!/usr/bin/env bash
# Local dev: build the helper site, make a localhost dev cert if missing, run the
# HTTPS server (WebRTC needs HTTPS in real browsers). No TURN, no tunnel.
#
# Two-phone testing (optional, manual, only if Aviv approves the run): in another
# terminal, a free Cloudflare quick tunnel needs no account and no payment:
#   cloudflared tunnel --no-tls-verify --url https://localhost:${PORT:-8443}
# This script never starts a tunnel by itself.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8443}"
CERT_DIR=".certs"
CERT="$CERT_DIR/localhost.pem"
KEY="$CERT_DIR/localhost-key.pem"

npm run build --workspace=web

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  mkdir -p "$CERT_DIR"
  if command -v mkcert >/dev/null 2>&1; then
    mkcert -cert-file "$CERT" -key-file "$KEY" localhost 127.0.0.1 ::1
  else
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
      -keyout "$KEY" -out "$CERT"
  fi
  chmod 600 "$KEY"
fi

PORT="$PORT" TLS_CERT="$CERT" TLS_KEY="$KEY" exec node --import tsx server/src/index.ts
