import type { WsServerMessage } from "@familyguide/shared";

type ServerErrorCode = Extract<WsServerMessage, { type: "error" }>["code"];
export type JoinErrorCode = ServerErrorCode | "disconnected";

const ERROR_MESSAGES: Record<JoinErrorCode, string> = {
  invalid: "הקוד שגוי או שהשיחה כבר הסתיימה.",
  expired: "תוקף הקוד פג. בקשו מהמבוגר קוד חדש.",
  already_joined: "כבר יש קרוב בשיחה הזו.",
  rate_limited: "נעשו יותר מדי ניסיונות. המתינו כמה דקות ונסו שוב.",
  not_found: "הקוד שגוי או שהשיחה כבר הסתיימה.",
  disconnected: "השיחה נגמרה.",
};

export function errorMessage(code: JoinErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function elderIosMessage(): string {
  return (
    "הגרסה הזו תומכת במי שצריך עזרה רק בטלפון אנדרואיד, דרך האפליקציה. " +
    "באייפון אי אפשר לשתף את המסך בגרסה הזו. " +
    "אם יש לכם טלפון אנדרואיד, התקינו בו את האפליקציה ובקשו עזרה משם."
  );
}

export function isIosElderAttempt(userAgent: string, role: "elder" | "helper"): boolean {
  return role === "elder" && /iPhone|iPad|iPod/.test(userAgent);
}

export function helperJoinViewHtml(): string {
  return `<section class="screen" dir="rtl" aria-labelledby="helper-title">
  <h1 id="helper-title">אני עוזר</h1>
  <form id="join-form" novalidate>
    <label for="code-input">הקוד מהמבוגר (6 ספרות)</label>
    <input id="code-input" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
    <button type="submit" class="big-button">התחבר</button>
  </form>
  <p id="join-error" class="error" role="alert" aria-live="assertive"></p>
</section>`;
}
