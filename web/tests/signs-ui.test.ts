import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { SIGN_KINDS, SIGN_LABELS } from "@familyguide/shared/signs";
import {
  buildSignMenu,
  signFromClick,
  applyLocalSign,
  clearLocalSign,
  sendSign,
  sendClear,
} from "../src/signs-ui.ts";

let dom: JSDOM;
let previousDocument: Document | undefined;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  previousDocument = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = dom.window.document;
});

afterEach(() => {
  (globalThis as { document?: Document }).document = previousDocument;
  dom.window.close();
});

describe("sign menu", () => {
  it("renders all ten Hebrew labels and places a single sign in normalized coords", () => {
    const picked: string[] = [];
    const menu = buildSignMenu((kind) => picked.push(kind));
    expect(menu.getAttribute("dir")).toBe("rtl");
    const buttons = Array.from(menu.querySelectorAll("button"));
    expect(buttons).toHaveLength(10);
    for (const kind of SIGN_KINDS) {
      expect(menu.textContent).toContain(SIGN_LABELS[kind]);
    }
    expect(buttons.map((b) => b.textContent)).toEqual(SIGN_KINDS.map((k) => SIGN_LABELS[k]));
    buttons[SIGN_KINDS.indexOf("zoom_in")].click();
    expect(picked).toEqual(["zoom_in"]);

    const payload = signFromClick("scroll_down", { width: 200, height: 400 }, 50, 100);
    expect(payload).toEqual({ type: "sign", kind: "scroll_down", x: 0.25, y: 0.25 });
    expect(signFromClick("tap", { width: 100, height: 100 }, 150, -10)).toEqual({
      type: "sign",
      kind: "tap",
      x: 1,
      y: 0,
    });
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, "")).toBeNull();
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, "   ")).toBeNull();
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10)).toBeNull();
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, "א".repeat(41))).toBeNull();
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, `  ${"א".repeat(40)}  `)).toEqual({
      type: "sign",
      kind: "note",
      x: 0.1,
      y: 0.1,
      text: "א".repeat(40),
    });
  });

  it("keeps only one sign on the layer and clear removes it", () => {
    const layer = document.createElement("div");
    document.body.append(layer);

    applyLocalSign(layer, { type: "sign", kind: "tap", x: 0.5, y: 0.5 });
    applyLocalSign(layer, { type: "sign", kind: "scroll_down", x: 0.25, y: 0.75 });
    expect(layer.children).toHaveLength(1);
    const sign = layer.children[0] as HTMLElement;
    expect(sign.classList.contains("sign-motion")).toBe(true);
    expect(sign.classList.contains("sign-motion--scroll_down")).toBe(true);
    expect(sign.classList.contains("sign-motion--tap")).toBe(false);
    expect(sign.textContent).toContain(SIGN_LABELS.scroll_down);
    expect(sign.style.left).toBe("25%");
    expect(sign.style.top).toBe("75%");

    applyLocalSign(layer, { type: "sign", kind: "note", x: 0.1, y: 0.1, text: "לחץ על הגדרות" });
    expect(layer.children).toHaveLength(1);
    expect(layer.textContent).toContain("לחץ על הגדרות");
    expect(layer.querySelectorAll(".sign-motion")).toHaveLength(1);

    clearLocalSign(layer);
    expect(layer.querySelectorAll(".sign-motion")).toHaveLength(0);
    expect(layer.children).toHaveLength(0);
  });

  it("sends sign and clear JSON only on an open channel", () => {
    const sent: string[] = [];
    const ch = { readyState: "open", send: (d: string) => sent.push(d) };
    expect(sendSign(ch, { type: "sign", kind: "tap", x: 0.5, y: 0.5 })).toBe(true);
    expect(JSON.parse(sent[0])).toEqual({ type: "sign", kind: "tap", x: 0.5, y: 0.5 });
    expect(sendClear(ch)).toBe(true);
    expect(JSON.parse(sent[1])).toEqual({ type: "clear_sign" });

    const closed = { readyState: "connecting", send: (d: string) => sent.push(d) };
    expect(sendSign(closed, { type: "sign", kind: "tap", x: 0.5, y: 0.5 })).toBe(false);
    expect(sendClear(closed)).toBe(false);
    expect(sent).toHaveLength(2);
  });
});
