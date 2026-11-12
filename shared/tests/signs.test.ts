import { describe, it, expect } from "vitest";
import {
  SIGN_KINDS,
  SIGN_LABELS,
  NOTE_MAX_LENGTH,
  clampCoord,
  parseSignPayload,
  parseSignsChannelMessage,
} from "../src/signs.ts";

describe("signs catalog", () => {
  it("has exactly the ten approved kinds with Hebrew labels", () => {
    expect([...SIGN_KINDS]).toEqual([
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
    ]);
    expect(SIGN_LABELS.tap).toBe("לחץ כאן");
    expect(SIGN_LABELS.long_press).toBe("לחיצה ארוכה");
    expect(SIGN_LABELS.scroll_up).toBe("גלול למעלה");
    expect(SIGN_LABELS.scroll_down).toBe("גלול למטה");
    expect(SIGN_LABELS.swipe_right).toBe("החלק ימינה");
    expect(SIGN_LABELS.swipe_left).toBe("החלק שמאלה");
    expect(SIGN_LABELS.zoom_in).toBe("זום פנימה");
    expect(SIGN_LABELS.zoom_out).toBe("זום החוצה");
    expect(SIGN_LABELS.back).toBe("חזור");
    expect(SIGN_LABELS.note).toBe("הערה");
  });

  it("clamps coordinates to 0..1", () => {
    expect(clampCoord(-0.2)).toBe(0);
    expect(clampCoord(1.4)).toBe(1);
    expect(clampCoord(0.5)).toBe(0.5);
    expect(clampCoord(Number.NaN)).toBe(0);
  });

  it("rejects notes longer than 40 characters and unknown kinds", () => {
    expect(NOTE_MAX_LENGTH).toBe(40);
    const tooLong = "א".repeat(41);
    expect(
      parseSignPayload({ type: "sign", kind: "note", x: 0.2, y: 0.3, text: tooLong }),
    ).toBeNull();
    expect(
      parseSignPayload({ type: "sign", kind: "explode", x: 0.2, y: 0.3 }),
    ).toBeNull();
    expect(
      parseSignPayload({ type: "sign", kind: "note", x: 0.2, y: 0.3, text: "גלול לאט" }),
    ).toEqual({ type: "sign", kind: "note", x: 0.2, y: 0.3, text: "גלול לאט" });
  });

  it("parses clear_sign and hangup and rejects other channel messages", () => {
    expect(parseSignsChannelMessage({ type: "clear_sign" })).toEqual({ type: "clear_sign" });
    expect(parseSignsChannelMessage({ type: "hangup" })).toEqual({ type: "hangup" });
    expect(parseSignsChannelMessage({ type: "remote_tap" })).toBeNull();
  });
});
