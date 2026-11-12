import type { WsClientMessage, WsServerMessage } from "@familyguide/shared";
import { elderIosMessage, errorMessage, helperJoinViewHtml, isIosElderAttempt } from "./join.ts";
import { createHelperPeer, disconnectMessage } from "./webrtc.ts";
import type { DisconnectReason, HelperPeer } from "./webrtc.ts";
import { NOTE_MAX_LENGTH, SIGN_LABELS } from "@familyguide/shared/signs";
import type { SignKind, SignPayload } from "@familyguide/shared/signs";
import {
  applyLocalSign,
  buildSignMenu,
  clearLocalSign,
  sendClear,
  sendSign,
  signFromClick,
} from "./signs-ui.ts";

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

type CallView = {
  video: HTMLVideoElement;
  layer: HTMLElement;
};

type CallViewOptions = {
  onHangup: () => void;
  /** Sends a sign on the signs channel; false if the channel is not open yet. */
  sendSignPayload: (payload: SignPayload) => boolean;
  sendClearSign: () => boolean;
};

const PICK_HINT = "בחרו סימן, ואז לחצו על המסך במקום הרצוי.";
const NOTE_HINT = `כתבו הערה (עד ${NOTE_MAX_LENGTH} תווים), ואז לחצו על המסך במקום הרצוי.`;
const NOTE_INVALID = `כתבו הערה באורך 1 עד ${NOTE_MAX_LENGTH} תווים.`;
const CHANNEL_NOT_READY = "החיבור עוד לא מוכן לסימנים. נסו שוב בעוד רגע.";

function showCall(opts: CallViewOptions): CallView | null {
  if (!app) return null;
  const section = document.createElement("section");
  section.className = "screen call-screen";
  section.dir = "rtl";

  let pendingKind: SignKind | null = null;

  const status = document.createElement("p");
  status.className = "message sign-status";
  status.setAttribute("role", "status");
  status.textContent = PICK_HINT;

  const noteRow = document.createElement("div");
  noteRow.className = "note-row";
  noteRow.hidden = true;
  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "note-input";
  noteInput.maxLength = NOTE_MAX_LENGTH;
  noteInput.dir = "rtl";
  noteInput.setAttribute("aria-label", SIGN_LABELS.note);
  noteRow.append(noteInput);

  const menu = buildSignMenu((kind) => {
    pendingKind = kind;
    menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
    });
    noteRow.hidden = kind !== "note";
    if (kind === "note") {
      status.textContent = NOTE_HINT;
      noteInput.focus();
    } else {
      status.textContent = `${SIGN_LABELS[kind]}: לחצו על המסך במקום הרצוי.`;
    }
  });

  const resetPick = (): void => {
    pendingKind = null;
    noteRow.hidden = true;
    noteInput.value = "";
    menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.setAttribute("aria-pressed", "false");
    });
  };

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "sign-button sign-button--clear";
  clearButton.textContent = "מחק סימן";
  menu.append(clearButton);

  const stage = document.createElement("div");
  stage.className = "video-stage";
  const video = document.createElement("video");
  video.playsInline = true;
  video.autoplay = true;
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("autoplay", "");
  const layer = document.createElement("div");
  layer.className = "sign-layer";
  layer.setAttribute("aria-hidden", "true");
  stage.append(video, layer);

  clearButton.addEventListener("click", () => {
    resetPick();
    clearLocalSign(layer);
    status.textContent = opts.sendClearSign() ? PICK_HINT : CHANNEL_NOT_READY;
  });

  video.addEventListener("click", (event) => {
    if (!pendingKind) return;
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const payload = signFromClick(
      pendingKind,
      { width: rect.width, height: rect.height },
      event.clientX - rect.left,
      event.clientY - rect.top,
      pendingKind === "note" ? noteInput.value : undefined,
    );
    if (!payload) {
      status.textContent = NOTE_INVALID;
      noteInput.focus();
      return;
    }
    if (!opts.sendSignPayload(payload)) {
      status.textContent = CHANNEL_NOT_READY;
      return;
    }
    applyLocalSign(layer, payload);
    resetPick();
    status.textContent = PICK_HINT;
  });

  const hangupButton = document.createElement("button");
  hangupButton.type = "button";
  hangupButton.className = "big-button";
  hangupButton.textContent = "סיום שיחה";
  hangupButton.addEventListener("click", opts.onHangup);

  section.append(menu, noteRow, status, stage, hangupButton);
  app.replaceChildren(section);
  return { video, layer };
}

function joinCall(code: string, showJoinError: (text: string) => void): void {
  const ws = new WebSocket(signalingUrl());
  let peer: HelperPeer | null = null;
  let view: CallView | null = null;
  let finished = false;

  // The elder opens the signs channel; until then there is nothing to send on.
  const withSignsChannel = (fn: (channel: RTCDataChannel) => boolean): boolean => {
    try {
      return peer ? fn(peer.getSignsChannel()) : false;
    } catch {
      return false;
    }
  };

  const send = (msg: WsClientMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const endCall = (reason: DisconnectReason): void => {
    if (finished) return;
    finished = true;
    if (view) clearLocalSign(view.layer);
    if (reason === "ended") withSignsChannel(sendClear);
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
        view = showCall({
          onHangup: () => endCall("ended"),
          sendSignPayload: (payload) => withSignsChannel((channel) => sendSign(channel, payload)),
          sendClearSign: () => withSignsChannel(sendClear),
        });
        peer = await createHelperPeer({
          sendSignal: (payload) => send({ type: "signal", payload }),
          sendHangup: () => send({ type: "hangup" }),
          onRemoteStream: (stream) => {
            if (view) view.video.srcObject = stream;
          },
          onSignsMessage: (signsMsg) => {
            if (signsMsg.type === "hangup") endCall("ended");
            else if (signsMsg.type === "clear_sign") {
              if (view) clearLocalSign(view.layer);
            } else if (view) applyLocalSign(view.layer, signsMsg);
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
