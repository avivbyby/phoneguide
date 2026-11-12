// shared/tests/session.test.ts
import { describe, it, expect } from "vitest";
import {
  generateSessionCode,
  isValidCodeFormat,
  SessionStore,
  UNUSED_TTL_MS,
} from "../src/session.ts";

describe("session codes", () => {
  it("generates a 6-digit code and rejects bad formats", () => {
    let i = 0;
    const digits = [0, 1, 2, 3, 4, 5];
    const code = generateSessionCode(() => digits[i++]);
    expect(code).toBe("012345");
    expect(isValidCodeFormat("012345")).toBe(true);
    expect(isValidCodeFormat("12345")).toBe(false);
    expect(isValidCodeFormat("12345a")).toBe(false);
  });
});

describe("SessionStore", () => {
  it("lets one helper join, then rejects a second, and expires after 10 unused minutes", () => {
    let now = 1_000_000;
    const store = new SessionStore({ now: () => now });
    const session = store.create();
    expect(session.code).toMatch(/^\d{6}$/);
    const first = store.join(session.code, "helper-a");
    expect(first.ok).toBe(true);
    const second = store.join(session.code, "helper-b");
    expect(second).toEqual({ ok: false, error: "already_joined" });
  });

  it("expires unused sessions after 10 minutes and invalidates on end", () => {
    let now = 1_000_000;
    const store = new SessionStore({ now: () => now });
    const session = store.create();
    now += UNUSED_TTL_MS + 1;
    expect(store.join(session.code, "h")).toEqual({ ok: false, error: "expired" });
    const live = store.create();
    store.end(live.code);
    expect(store.join(live.code, "h")).toEqual({ ok: false, error: "invalid" });
    expect(store.get(live.code)).toBeUndefined();
  });

  it("rate-limits more than 10 failed joins from the same client in 5 minutes", () => {
    let now = 1_000_000;
    const store = new SessionStore({ now: () => now });
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(store.join("000000", "1.2.3.4"));
    }
    expect(results[9].ok).toBe(false);
    expect(results[9]).toEqual({ ok: false, error: "invalid" });
    expect(results[10]).toEqual({ ok: false, error: "rate_limited" });
  });

  it("removes an expired session once it has been reported as expired", () => {
    let now = 1_000_000;
    const store = new SessionStore({ now: () => now });
    const session = store.create();
    now += UNUSED_TTL_MS + 1;
    expect(store.join(session.code, "h")).toEqual({ ok: false, error: "expired" });
    expect(store.join(session.code, "h")).toEqual({ ok: false, error: "invalid" });
  });
});
