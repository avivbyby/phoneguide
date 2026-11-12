export {
  SIGN_KINDS,
  SIGN_LABELS,
  NOTE_MAX_LENGTH,
  clampCoord,
  parseSignPayload,
  parseSignsChannelMessage,
} from "./signs.ts";

export type {
  SignKind,
  SignPayload,
  SignsChannelMessage,
} from "./signs.ts";

export const SIGNS_CHANNEL = "signs";
export const STUN_URL = "stun:stun.l.google.com:19302";

export type WsClientMessage =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "signal"; payload: unknown }
  | { type: "hangup" };

export type WsServerMessage =
  | { type: "created"; code: string }
  | { type: "joined"; role: "elder" | "helper" }
  | { type: "peer-joined" }
  | { type: "signal"; payload: unknown }
  | { type: "peer-left" }
  | {
      type: "error";
      code: "invalid" | "expired" | "already_joined" | "rate_limited" | "not_found";
    };

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

export function parseWsClientMessage(data: unknown): WsClientMessage | null {
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;

  switch (value.type) {
    case "create":
      return { type: "create" };
    case "join":
      if (typeof value.code !== "string") return null;
      return { type: "join", code: value.code };
    case "signal":
      if (!("payload" in value)) return null;
      return { type: "signal", payload: value.payload };
    case "hangup":
      return { type: "hangup" };
    default:
      return null;
  }
}
