import { NOTE_MAX_LENGTH, SIGN_KINDS, SIGN_LABELS, clampCoord } from "@familyguide/shared/signs";
import type { SignKind, SignPayload } from "@familyguide/shared/signs";

// Signs are instructions drawn for the elder; they never perform a gesture.

export type SignsSendChannel = { readyState: string; send(data: string): void };

export function buildSignMenu(onPick: (kind: SignKind) => void): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "sign-menu";
  menu.setAttribute("dir", "rtl");
  for (const kind of SIGN_KINDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sign-button";
    button.dataset.kind = kind;
    button.textContent = SIGN_LABELS[kind];
    button.addEventListener("click", () => onPick(kind));
    menu.append(button);
  }
  return menu;
}

/** clientX/clientY are relative to the video element's top-left corner. */
export function signFromClick(
  kind: SignKind,
  video: { width: number; height: number },
  clientX: number,
  clientY: number,
  text?: string,
): SignPayload | null {
  const x = clampCoord(clientX / video.width);
  const y = clampCoord(clientY / video.height);
  if (kind === "note") {
    const trimmed = (text ?? "").trim();
    if (trimmed.length < 1 || trimmed.length > NOTE_MAX_LENGTH) return null;
    return { type: "sign", kind, x, y, text: trimmed };
  }
  return { type: "sign", kind, x, y };
}

export function applyLocalSign(layer: HTMLElement, payload: SignPayload): void {
  clearLocalSign(layer);
  const sign = document.createElement("div");
  sign.className = `sign-motion sign-motion--${payload.kind}`;
  sign.dir = "rtl";
  sign.style.left = `${payload.x * 100}%`;
  sign.style.top = `${payload.y * 100}%`;

  const marker = document.createElement("div");
  marker.className = "sign-marker";
  marker.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 2; i++) {
    const part = document.createElement("span");
    part.className = "sign-part";
    marker.append(part);
  }

  const label = document.createElement("div");
  label.className = "sign-label";
  label.textContent =
    payload.kind === "note" && payload.text ? payload.text : SIGN_LABELS[payload.kind];

  sign.append(marker, label);
  layer.append(sign);
}

export function clearLocalSign(layer: HTMLElement): void {
  layer.replaceChildren();
}

export function sendSign(channel: SignsSendChannel, payload: SignPayload): boolean {
  if (channel.readyState !== "open") return false;
  channel.send(JSON.stringify(payload));
  return true;
}

export function sendClear(channel: SignsSendChannel): boolean {
  if (channel.readyState !== "open") return false;
  channel.send(JSON.stringify({ type: "clear_sign" }));
  return true;
}
