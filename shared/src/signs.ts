export type SignKind =
  | "tap"
  | "long_press"
  | "scroll_up"
  | "scroll_down"
  | "swipe_right"
  | "swipe_left"
  | "zoom_in"
  | "zoom_out"
  | "back"
  | "note";

export const SIGN_KINDS: readonly SignKind[] = [
  "tap",
  "long_press",
  "scroll_up",
  "scroll_down",
  "swipe_right",
  "swipe_left",
  "zoom_in",
  "zoom_out",
  "back",
  "note",
];

export const SIGN_LABELS: Record<SignKind, string> = {
  tap: "לחץ כאן",
  long_press: "לחיצה ארוכה",
  scroll_up: "גלול למעלה",
  scroll_down: "גלול למטה",
  swipe_right: "החלק ימינה",
  swipe_left: "החלק שמאלה",
  zoom_in: "זום פנימה",
  zoom_out: "זום החוצה",
  back: "חזור",
  note: "הערה",
};

export const NOTE_MAX_LENGTH = 40;

export function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export type SignPayload = {
  type: "sign";
  kind: SignKind;
  x: number;
  y: number;
  text?: string;
};

export type SignsChannelMessage =
  | SignPayload
  | { type: "clear_sign" }
  | { type: "hangup" };

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

function isSignKind(value: unknown): value is SignKind {
  return typeof value === "string" && (SIGN_KINDS as readonly string[]).includes(value);
}

export function parseSignPayload(data: unknown): SignPayload | null {
  if (!isRecord(data)) return null;
  if (data.type !== "sign") return null;
  if (!isSignKind(data.kind)) return null;
  if (typeof data.x !== "number" || typeof data.y !== "number") return null;

  const kind = data.kind;
  const x = clampCoord(data.x);
  const y = clampCoord(data.y);

  if (kind === "note") {
    if (typeof data.text !== "string") return null;
    const text = data.text.trim();
    if (text.length < 1 || text.length > NOTE_MAX_LENGTH) return null;
    return { type: "sign", kind, x, y, text };
  }

  return { type: "sign", kind, x, y };
}

export function parseSignsChannelMessage(data: unknown): SignsChannelMessage | null {
  if (!isRecord(data)) return null;
  if (data.type === "clear_sign" || data.type === "hangup") {
    if (Object.keys(data).length !== 1) return null;
    return { type: data.type };
  }
  return parseSignPayload(data);
}
