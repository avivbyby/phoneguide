import { describe, it, expect } from "vitest";
import {
  errorMessage,
  elderIosMessage,
  isIosElderAttempt,
  helperJoinViewHtml,
} from "../src/join.ts";

describe("helper join copy", () => {
  it("returns the approved Hebrew errors and an RTL join form", () => {
    expect(errorMessage("invalid")).toBe("הקוד שגוי או שהשיחה כבר הסתיימה.");
    expect(errorMessage("expired")).toBe("תוקף הקוד פג. בקשו מהמבוגר קוד חדש.");
    expect(errorMessage("already_joined")).toBe("כבר יש קרוב בשיחה הזו.");
    expect(helperJoinViewHtml()).toContain("dir=\"rtl\"");
    expect(helperJoinViewHtml()).toContain("אני עוזר");
    expect(helperJoinViewHtml()).toContain("התחבר");
  });

  it("detects an iPhone elder and explains Android-only support", () => {
    expect(isIosElderAttempt("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "elder")).toBe(true);
    expect(isIosElderAttempt("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "helper")).toBe(false);
    expect(isIosElderAttempt("Mozilla/5.0 (Linux; Android 14)", "elder")).toBe(false);
    expect(elderIosMessage()).toMatch(/אנדרואיד/);
    expect(elderIosMessage()).not.toMatch(/בקרוב|בקרוב נתמוך|בקרוב אפשר/);
  });
});
