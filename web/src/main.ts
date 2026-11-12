import type { WsClientMessage, WsServerMessage } from "@familyguide/shared";
import { elderIosMessage, errorMessage, helperJoinViewHtml, isIosElderAttempt } from "./join.ts";
import { createHelperPeer, disconnectMessage } from "./webrtc.ts";
import type { DisconnectReason, HelperPeer } from "./webrtc.ts";

const ELDER_USE_APP_MESSAGE = "כדי לקבל עזרה, פתחו את האפליקציה בטלפון האנדרואיד שלכם.";

// Same rule as isValidCodeFormat in @familyguide/shared/session, which cannot be
// bundled for the browser because that module imports node:crypto.
function isValidCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code);
}

const app = document.getElementById("app");

function showMessage(text: string): void {
  if (!app) return;
  const section = document.createElement("section");
  section.className = "screen";
  section.dir = "rtl";
  const p = document.createElement("p");
  p.className = "message";
  p.textContent = text;
  section.append(p);
  app.replaceChildren(section);
}

function showHelperJoin(): void {
  if (!app) return;
  app.innerHTML = helperJoinViewHtml();
  const form = document.getElementById("join-form") as HTMLFormElement | null;
  const input = document.getElementById("code-input") as HTMLInputElement | null;
  const error = document.getElementById("join-error");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = input?.value.trim() ?? "";
    if (!isValidCodeFormat(code)) {
      if (error) error.textContent = errorMessage("invalid");
      return;
    }
    if (error) error.textContent = "";
    joinCall(code, (text) => {
      if (error) error.textContent = text;
    });
  });
  input?.focus();
}

// Same host as the page; the server listens for WebSockets on /ws.
function signalingUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function showCall(onHangup: () => void): HTMLVideoElement | null {
  if (!app) return null;
  const section = document.createElement("section");
  section.className = "screen";
  section.dir = "rtl";
  const video = document.createElement("video");
  video.playsInline = true;
  video.autoplay = true;
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("autoplay", "");
  video.style.width = "100%";
  const hangupButton = document.createElement("button");
  hangupButton.type = "button";
  hangupButton.className = "big-button";
  hangupButton.textContent = "סיום שיחה";
  hangupButton.addEventListener("click", onHangup);
  section.append(video, hangupButton);
  app.replaceChildren(section);
  return video;
}

function joinCall(code: string, showJoinError: (text: string) => void): void {
  const ws = new WebSocket(signalingUrl());
  let peer: HelperPeer | null = null;
  let finished = false;

  const send = (msg: WsClientMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const endCall = (reason: DisconnectReason): void => {
    if (finished) return;
    finished = true;
    peer?.hangup();
    ws.close();
    showMessage(disconnectMessage(reason));
  };

  ws.addEventListener("open", () => send({ type: "join", code }));

  ws.addEventListener("message", async (event) => {
    let msg: WsServerMessage;
    try {
      msg = JSON.parse(String(event.data)) as WsServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "joined": {
        const video = showCall(() => endCall("ended"));
        peer = await createHelperPeer({
          sendSignal: (payload) => send({ type: "signal", payload }),
          sendHangup: () => send({ type: "hangup" }),
          onRemoteStream: (stream) => {
            if (video) video.srcObject = stream;
          },
          onSignsMessage: (signsMsg) => {
            if (signsMsg.type === "hangup") endCall("ended");
          },
          onDisconnected: (reason) => endCall(reason),
        });
        break;
      }
      case "signal":
        await peer?.handleSignal(msg.payload);
        break;
      case "peer-left":
        endCall("ended");
        break;
      case "error":
        finished = true;
        ws.close();
        showJoinError(errorMessage(msg.code));
        break;
    }
  });

  ws.addEventListener("close", () => {
    if (!finished && peer) endCall("ended");
    else if (!finished) {
      finished = true;
      showJoinError(errorMessage("disconnected"));
    }
  });
}

function showElder(): void {
  if (isIosElderAttempt(navigator.userAgent, "elder")) {
    showMessage(elderIosMessage());
  } else {
    showMessage(ELDER_USE_APP_MESSAGE);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-role]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.role === "helper") showHelperJoin();
    else showElder();
  });
});
