<div dir="rtl" lang="he">

# תוכנית בנייה: כלי סיוע משפחתי במסך הטלפון

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לבנות אב-טיפוס שבו קרוב, מדפדפן בטלפון, נכנס בקוד לשיחה עם מבוגר באנדרואיד, רואה את המסך, ומציב מתפריט סימן ניווט (לחיצה, גלילה, זום או הערה) שמופיע על מסך המבוגר — בלי שליטה מרחוק ובלי דיבור.

**Architecture:** שרת תיאום ב־WebSocket יוצר שיחות עם קוד בן 6 ספרות ומעביר רק אותות חיבור (SDP/ICE). שידור המסך עובר ב־WebRTC ישירות בין המכשירים, בלי שמע ובלי שמירת וידאו. סימנים עוברים בערוץ נתונים בשם `signs`. אתר ויט+טייפסקריפט לקרוב; אפליקציית קוטלין דקה למבוגר (שיתוף מסך ושכבת סימנים).

**Tech Stack:** Node.js 20+, TypeScript, Vitest, Vite 5, חבילת `ws`, WebRTC מובנה בדפדפן, Android Kotlin minSdk 26 עם `io.getstream:stream-webrtc-android`, STUN ציבורי `stun:stun.l.google.com:19302`, HTTPS דרך השרת; לבדיקה בטלפונים אמיתיים — מנהרה חינמית (`cloudflared`) בלי תשלום.

## Global Constraints

- כל ממשק שנבנה הוא בעברית ומימין לשמאל (RTL).
- אין חשבונות, אין תשלום, ואין דיבור בשיחה (וידאו מסך בלבד, בלי רצועת שמע).
- קוד שיחה: 6 ספרות, פג אחרי 10 דקות אם אף קרוב לא הצטרף, ומתבטל מיד בסיום שיחה. קרוב אחד בלבד לשיחה.
- סימן אחד פעיל בכל רגע; סימן חדש מחליף את הקודם; «מחק סימן» לא מסיים את השיחה.
- הערה חופשית: עד 40 תווים. מיקום סימן בנקודות יחסיות 0 עד 1.
- אצל המבוגר חיווי «רואים את המסך» גלוי כל עוד השיחה פעילה, ואי אפשר להסתיר אותו בלי לסיים.
- הסימנים הם הוראה בלבד — הם לא לוחצים, לא מגללים ולא שולטים בטלפון של המבוגר.
- השידור לא מוקלט ולא נשמר בשרת. אין שרת ממסר (TURN) בתשלום; אם חיבור ישיר נכשל — הודעת שגיאה ברורה.
- אפליקציית המבוגר מופצת כקובץ התקנה לבדיקה, בלי חנות גוגל. מבוגר עם אייפון מקבל באתר הסבר ישר שהגרסה תומכת במבוגר באנדרואיד בלבד.
- אין להוציא כסף ואין לחבר חשבון של אביב בלי אישור מפורש.

---

## מבנה הקבצים

```
family-phone-guide/
  shared/src/signs.ts          — סוגי סימנים, תוויות עברית, בדיקת הערה ומיקום
  shared/src/protocol.ts       — הודעות WebSocket וערוץ הסימנים
  shared/src/session.ts        — יצירת קוד, הצטרפות, פקיעה, קרוב אחד, הגבלת ניחושים
  shared/tests/*.test.ts
  server/src/index.ts          — HTTPS, הגשת האתר, WebSocket
  server/src/signaling.ts      — חיבור לקוחות לשיחה והעברת אותות
  server/tests/*.test.ts
  web/index.html
  web/src/main.ts              — כניסת קרוב, הסבר לאייפון כמבוגר, סיום
  web/src/webrtc.ts            — קבלת שידור וערוץ signs
  web/src/signs-ui.ts          — תפריט סימנים, הצבה, מחיקה, הערה
  web/src/styles.css           — RTL, כפתורים גדולים
  web/tests/*.test.ts
  android/                     — אפליקציית המבוגר (Kotlin)
    app/src/main/java/app/familyguide/elder/
      SessionClient.kt         — יצירת שיחה ואותות
      SignOverlay.kt           — ציור סימנים מעל המסך
      ScreenShareService.kt    — MediaProjection + WebRTC
      MainActivity.kt
```

יחידות נפרדות, כל אחת עם ממשק ברור. השרת לא מכיר ציור; האתר לא מכיר שכבת אנדרואיד; שניהם מדברים באותו פרוטוקול מ־`shared`.

---

### Task 1: קטלוג סימנים ופרוטוקול משותף

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/signs.ts`
- Create: `shared/src/protocol.ts`
- Create: `shared/tests/signs.test.ts`
- Create: `package.json` (שורש הריפו, workspaces: `shared`, `server`, `web`)
- Create: `vitest.config.ts`
- Test: `shared/tests/signs.test.ts`

**Interfaces:**
- Consumes: כלום (משימה ראשונה)
- Produces:
  - `export type SignKind = "tap" | "long_press" | "scroll_up" | "scroll_down" | "swipe_right" | "swipe_left" | "zoom_in" | "zoom_out" | "back" | "note"`
  - `export const SIGN_KINDS: readonly SignKind[]`
  - `export const SIGN_LABELS: Record<SignKind, string>` — הערכים בדיוק: «לחץ כאן», «לחיצה ארוכה», «גלול למעלה», «גלול למטה», «החלק ימינה», «החלק שמאלה», «זום פנימה», «זום החוצה», «חזור», «הערה»
  - `export const NOTE_MAX_LENGTH = 40`
  - `export function clampCoord(n: number): number` — מחזיר מספר בטווח 0..1; לא-מספר הופך ל־0
  - `export function parseSignPayload(data: unknown): SignPayload | null`
  - `export type SignPayload = { type: "sign"; kind: SignKind; x: number; y: number; text?: string }`
  - `export type SignsChannelMessage = SignPayload | { type: "clear_sign" } | { type: "hangup" }`
  - `export function parseSignsChannelMessage(data: unknown): SignsChannelMessage | null`
  - `export type WsClientMessage = { type: "create" } | { type: "join"; code: string } | { type: "signal"; payload: unknown } | { type: "hangup" }`
  - `export type WsServerMessage = { type: "created"; code: string } | { type: "joined"; role: "elder" | "helper" } | { type: "peer-joined" } | { type: "signal"; payload: unknown } | { type: "peer-left" } | { type: "error"; code: "invalid" | "expired" | "already_joined" | "rate_limited" | "not_found" }`
  - `export function parseWsClientMessage(data: unknown): WsClientMessage | null`
  - `export const SIGNS_CHANNEL = "signs"`
  - `export const STUN_URL = "stun:stun.l.google.com:19302"`

- [ ] **Step 1: Write the failing test**

```ts
// shared/tests/signs.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- shared/tests/signs.test.ts`  
(אחרי יצירת `package.json` עם `"test": "vitest run"` ו־workspace ל־shared; בהתחלה בלי `signs.ts` מלא.)  
Expected: FAIL — `Cannot find module '../src/signs.ts'` או שהייצוא חסר.

- [ ] **Step 3: Write minimal implementation**

`package.json` בשורש: `{ "name": "family-phone-guide", "private": true, "workspaces": ["shared", "server", "web"], "scripts": { "test": "vitest run" }, "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" } }`

`shared/package.json`: `{ "name": "@familyguide/shared", "type": "module", "main": "src/protocol.ts", "exports": { ".": "./src/protocol.ts", "./signs": "./src/signs.ts", "./session": "./src/session.ts" } }`

יישום `shared/src/signs.ts` לפי הממשקים למעלה: `clampCoord` עם `Number.isFinite`; `parseSignPayload` דורש `type==="sign"`, `kind` מתוך `SIGN_KINDS`, `x`/`y` מספרים (אחרי clamp), ו־`text` רק ב־`note` (מחרוזת, אורך 1..40, אחרי `trim`). `parseSignsChannelMessage` מפנה ל־`parseSignPayload` או מקבל `{type:"clear_sign"}` / `{type:"hangup"}` בלי שדות נוספים מזיקים.

`shared/src/protocol.ts` מייצא את סוגי ה־WebSocket, `SIGNS_CHANNEL`, `STUN_URL`, ו־`parseWsClientMessage` (מחרוזת JSON או אובייקט; `join` דורש `code` מחרוזת; אחרת `null`). ייצא מחדש את הכל מ־`signs.ts` כדי שייבוא מ־`@familyguide/shared` יעבוד.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- shared/tests/signs.test.ts`  
Expected: PASS, כל ארבעת המבחנים ירוקים.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts shared/
git commit -m "feat: קטלוג סימנים ופרוטוקול משותף"
```

---

### Task 2: מחסן שיחות — קוד, פקיעה, קרוב אחד, הגבלת ניחושים

**Files:**
- Create: `shared/src/session.ts`
- Create: `shared/tests/session.test.ts`
- Test: `shared/tests/session.test.ts`

**Interfaces:**
- Consumes: כלום מלוגיקת סימנים (רק TypeScript)
- Produces:
  - `export const CODE_LENGTH = 6`
  - `export const UNUSED_TTL_MS = 10 * 60 * 1000`
  - `export const RATE_LIMIT_MAX = 10`
  - `export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000`
  - `export function generateSessionCode(randomDigit?: () => number): string` — 6 ספרות, כולל אפסים מובילים; `randomDigit` מחזיר 0..9 (ברירת מחדל: אקראי מאובטח)
  - `export function isValidCodeFormat(code: string): boolean` — בדיוק 6 ספרות
  - `export type JoinError = "invalid" | "expired" | "already_joined" | "rate_limited"`
  - `export type JoinOk = { ok: true; session: Session }`
  - `export type JoinFail = { ok: false; error: JoinError }`
  - `export type Session = { code: string; createdAt: number; helperJoined: boolean }`
  - `export class SessionStore` עם בנאי `constructor(opts?: { now?: () => number })`
    - `create(): Session`
    - `join(code: string, clientId: string): JoinOk | JoinFail` — `clientId` הוא מזהה הלקוח (למשל IP) להגבלת ניחושים
    - `end(code: string): void`
    - `get(code: string): Session | undefined` — לא מחזיר שיחה שפג תוקפה או שהסתיימה
    - `hasHelper(code: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(results[9].error).toBe("invalid");
    expect(results[10]).toEqual({ ok: false, error: "rate_limited" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- shared/tests/session.test.ts`  
Expected: FAIL — המודול `session.ts` חסר.

- [ ] **Step 3: Write minimal implementation**

`SessionStore`: מפה לפי קוד. `create` מייצר קוד (אם יש התנגשות — ניסיון חוזר עד קוד פנוי). `join`: אם `clientId` חרג מ־10 כשלונות בחלון 5 דקות → `rate_limited` (בלי לחשוף אם הקוד קיים). אחרת אם הפורמט שגוי או אין שיחה או השיחה הסתיימה → `invalid` וסופרים כישלון. אם `now - createdAt > UNUSED_TTL_MS` ו־`helperJoined===false` → `expired` וסופרים כישלון. אם `helperJoined` → `already_joined` (זה לא ניחוש כושל של קוד, לא סופרים להגבלה). הצלחה: `helperJoined=true`, מאפסים כשלונות ל־`clientId`. `end` מוחק את השיחה. `generateSessionCode` ברירת מחדל: `crypto.randomInt(0, 10)` לכל ספרה.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- shared/tests/session.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/session.ts shared/tests/session.test.ts
git commit -m "feat: מחסן שיחות עם פקיעה, קרוב אחד והגבלת ניחושים"
```

---

### Task 3: שרת תיאום WebSocket

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/signaling.ts`
- Create: `server/src/index.ts`
- Create: `server/tests/signaling.test.ts`
- Test: `server/tests/signaling.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `parseWsClientMessage`, סוגי `WsServerMessage` מ־`@familyguide/shared`
- Produces:
  - `export function attachSignaling(server: HttpServer, store?: SessionStore): WebSocketServer` — מאזין בנתיב `/ws`
  - לכל חיבור: הודעת `create` משיבה `{ type: "created", code }`; `join` מוצלח משיב לקרוב `{ type: "joined", role: "helper" }` ולמבוגר `{ type: "peer-joined" }`; `signal` מועבר רק לבן הזוג באותה שיחה; `hangup` או ניתוק סוגרים את השיחה (`store.end`) ושולחים לצד השני `{ type: "peer-left" }`; שני הצדדים מנותקים. אחרי `hangup` הקוד לא שמיש. אין שמירת וידאו ואין העברת מדיה בשרת.

- [ ] **Step 1: Write the failing test**

במבחן: להרים `http.createServer` + `attachSignaling` עם `SessionStore` שנשלט בזמן, לחבר שני לקוחות `ws`, לשלוח JSON. לכסות:

1. create → `created` עם קוד בן 6 ספרות; join עם הקוד → הקרוב מקבל `joined`/`helper`, המבוגר מקבל `peer-joined`.
2. join לקוד שגוי → `{ type: "error", code: "invalid" }`.
3. אחרי hangup מהמבוגר, הקרוב מקבל `peer-left`, ו־join מחדש עם אותו קוד → `error`/`invalid`.
4. `signal` מהמבוגר מגיע רק לקרוב (אותו `payload`), לא למבוגר עצמו.
5. חיבור שלישי שמצטרף לאותו קוד אחרי קרוב אחד → `already_joined`.

המבחן משתמש ב־`vitest`, `node:http`, וחבילת `ws`. לא לבדוק WebRTC כאן.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- server/tests/signaling.test.ts`  
Expected: FAIL — `attachSignaling` חסר. להוסיף ל־`server/package.json` תלות `ws` ו־`@familyguide/shared`.

- [ ] **Step 3: Write minimal implementation**

`signaling.ts`: מפה `code -> { elder: WebSocket, helper?: WebSocket }`. `create` רק כשעדיין אין שיחה לחיבור. כתובת הלקוח ל־`join`: `socket` forwarded IP או `127.0.0.1` בבדיקות (`clientId`). `index.ts` בשלב זה יכול להיות דק: ייצוא הפונקציה בלבד; האזנה בפורט תתווסף במשימת ההגשה (Task 7). לא לחשוף רשימת שיחות פעילות ב־HTTP.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- server/tests/signaling.test.ts`  
Expected: PASS, כל חמשת המקרים ירוקים.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat: שרת תיאום WebSocket לשיחות ואותות"
```

---

### Task 4: אתר הקרוב — כניסה, שגיאות, הסבר לאייפון, סיום

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/src/styles.css`
- Create: `web/src/main.ts`
- Create: `web/src/join.ts`
- Create: `web/tests/join.test.ts`
- Create: `web/vite.config.ts`
- Test: `web/tests/join.test.ts`

**Interfaces:**
- Consumes: `isValidCodeFormat`, `parseWsClientMessage` / סוגי שגיאת שרת
- Produces:
  - `export function helperJoinViewHtml(): string` — מסך RTL: כותרת «אני עוזר», שדה קוד 6 ספרות, כפתור «התחבר», אזור הודעת שגיאה
  - `export function errorMessage(code: "invalid" | "expired" | "already_joined" | "rate_limited" | "not_found" | "disconnected"): string` — טקסטים קבועים בעברית (ראה למטה)
  - `export function elderIosMessage(): string` — הסבר ישר: הגרסה הזו תומכת במבוגר באנדרואיד בלבד, דרך האפליקציה
  - `export function isIosElderAttempt(userAgent: string, role: "elder" | "helper"): boolean` — true אם `role==="elder"` וה־UA מכיל iPhone/iPad/iPod

טקסטים ל־`errorMessage` (בדיוק):
- `invalid`: «הקוד שגוי או שהשיחה כבר הסתיימה.»
- `expired`: «תוקף הקוד פג. בקשו מהמבוגר קוד חדש.»
- `already_joined`: «כבר יש קרוב בשיחה הזו.»
- `rate_limited`: «נעשו יותר מדי ניסיונות. המתינו כמה דקות ונסו שוב.»
- `not_found`: «הקוד שגוי או שהשיחה כבר הסתיימה.»
- `disconnected`: «השיחה נגמרה.»

- [ ] **Step 1: Write the failing test**

```ts
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
```

(ההודעה לאייפון צריכה להיות ישרה ומלאה: הגרסה תומכת במבוגר באנדרואיד בלבד, באמצעות האפליקציה — בלי הבטחה שגויה.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/join.test.ts`  
Expected: FAIL — המודול חסר.

- [ ] **Step 3: Write minimal implementation**

`join.ts` לפי הממשקים. `index.html`: `lang="he" dir="rtl"`, בחירת תפקיד («אני עוזר» / «אני צריך עזרה»). בחירת «אני צריך עזרה» באייפון מציגה `elderIosMessage()` בלבד, בלי טופס שיתוף מסך. `styles.css`: כיוון RTL, כפתורים גדולים, ניגודיות גבוהה. `main.ts` בשלב זה מרנדר את המסכים האלה בלבד (בלי WebRTC).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/join.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: מסכי כניסה בעברית, שגיאות, והסבר למבוגר באייפון"
```

---

### Task 5: אתר הקרוב — קבלת שידור וערוץ סימנים

**Files:**
- Create: `web/src/webrtc.ts`
- Create: `web/tests/webrtc.test.ts`
- Modify: `web/src/main.ts`
- Test: `web/tests/webrtc.test.ts`

**Interfaces:**
- Consumes: `SIGNS_CHANNEL`, `STUN_URL`, `parseSignsChannelMessage`, הודעות `signal` / `peer-joined` / `peer-left` מהשרת
- Produces:
  - `export type IceServers = { iceServers: [{ urls: typeof STUN_URL }] }` — בלי TURN
  - `export async function createHelperPeer(opts: { sendSignal: (payload: unknown) => void; onRemoteStream: (stream: MediaStream) => void; onSignsMessage: (msg: SignsChannelMessage) => void; onDisconnected: () => void; }): Promise<HelperPeer>`
  - `export type HelperPeer = { handleSignal(payload: unknown): Promise<void>; getSignsChannel(): RTCDataChannel; hangup(): void }`
  - הקרוב הוא העונה (answerer): אחרי `handleSignal` של offer, שולח answer דרך `sendSignal`. לא מוסיפים `audio` (לא `offerToReceiveAudio`, ואין `addTransceiver("audio")`). ערוץ `signs` נפתח אצל המבוגר (`negotiated: false`, שם `signs`); הקרוב מאזין ב־`ondatachannel`. `hangup()` סוגר את הערוץ ואת ה־peer ושולח ב־WS `{type:"hangup"}`. אם ICE נכשל (`connectionState==="failed"`) קוראים ל־`onDisconnected` עם מצב שאפשר לתרגם להודעה: «לא הצלחנו להתחבר ישירות. נסו רשת אחרת או לקרב את שני הטלפונים.» — בלי להתחבר ל־TURN.

- [ ] **Step 1: Write the failing test**

מבחן יחידה עם mock של `RTCPeerConnection` (מעבירים factory אופציונלי ל־`createHelperPeer` כ־`opts.peerFactory`) שבודק: (א) `iceServers` הוא רק ה־STUN שאושר; (ב) אין transceiver או track של audio; (ג) `hangup` קורא `close` ולא משאיר ערוץ פתוח; (ד) הודעת `connectionState=failed` מפעילה `onDisconnected`. בלי רשת חיה.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/webrtc.test.ts`  
Expected: FAIL — `createHelperPeer` חסר.

- [ ] **Step 3: Write minimal implementation**

`webrtc.ts` לפי הממשק. `main.ts`: אחרי `joined`, יוצרים `HelperPeer`, מציגים `<video playsinline autoplay>` לשידור, ומחברים `peer-left` / ניתוק ל־`errorMessage("disconnected")` ולסגירה.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/webrtc.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/webrtc.ts web/tests/webrtc.test.ts web/src/main.ts
git commit -m "feat: קבלת שידור המסך אצל הקרוב בלי שמע ובלי TURN"
```

---

### Task 6: תפריט הסימנים אצל הקרוב

**Files:**
- Create: `web/src/signs-ui.ts`
- Create: `web/tests/signs-ui.test.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/styles.css`
- Test: `web/tests/signs-ui.test.ts`

**Interfaces:**
- Consumes: `SIGN_KINDS`, `SIGN_LABELS`, `NOTE_MAX_LENGTH`, `clampCoord`, `SignPayload`, `SIGNS_CHANNEL`
- Produces:
  - `export function buildSignMenu(onPick: (kind: SignKind) => void): HTMLElement` — כפתור לכל 10 הסימנים, עם `SIGN_LABELS`, `dir="rtl"`
  - `export function signFromClick(kind: SignKind, video: { width: number; height: number }, clientX: number, clientY: number, text?: string): SignPayload | null` — ממיר לחיצה ליחס 0..1 ביחס לרכיב הווידאו; אם `kind==="note"` בלי טקסט תקין (ריק או מעל 40 אחרי trim) מחזיר `null`
  - `export function applyLocalSign(layer: HTMLElement, payload: SignPayload): void` — מציג סימן אחד (מוחק קודם), עם התווית בעברית ומחלקת אנימציה `sign-motion sign-motion--{kind}`; ל־`note` מציג את הטקסט
  - `export function clearLocalSign(layer: HTMLElement): void`
  - `export function sendSign(channel: { readyState: string; send(data: string): void }, payload: SignPayload): boolean` — שולח JSON רק אם `readyState==="open"`, אחרת false
  - `export function sendClear(channel: { readyState: string; send(data: string): void }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { SIGN_LABELS } from "@familyguide/shared/signs";
import {
  buildSignMenu,
  signFromClick,
  applyLocalSign,
  clearLocalSign,
  sendSign,
  sendClear,
} from "../src/signs-ui.ts";

describe("sign menu", () => {
  it("renders all ten Hebrew labels and places a single sign in normalized coords", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const menu = buildSignMenu.call({ document: dom.window.document }, () => {});
    // implement buildSignMenu against global document; in test, set global document from JSDOM first
    expect(menu.textContent).toContain(SIGN_LABELS.scroll_down);
    expect(menu.textContent).toContain(SIGN_LABELS.zoom_in);
    const payload = signFromClick("scroll_down", { width: 200, height: 400 }, 50, 100);
    expect(payload).toEqual({ type: "sign", kind: "scroll_down", x: 0.25, y: 0.25 });
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, "")).toBeNull();
    expect(signFromClick("note", { width: 100, height: 100 }, 10, 10, "א".repeat(41))).toBeNull();
  });

  it("keeps only one sign on the layer and clear removes it", () => {
    // JSDOM layer 200x200, apply two signs, one child remains, then clearLocalSign leaves zero sign nodes
    const sent: string[] = [];
    const ch = { readyState: "open", send: (d: string) => sent.push(d) };
    sendSign(ch, { type: "sign", kind: "tap", x: 0.5, y: 0.5 });
    expect(JSON.parse(sent[0]).kind).toBe("tap");
    sendClear(ch);
    expect(JSON.parse(sent[1])).toEqual({ type: "clear_sign" });
  });
});
```

לבנות את המבחן בפועל עם JSDOM כפי שהקוד באמת משתמש ב־`document` גלובלי (להגדיר `globalThis.document` במבחן). הקואורדינטות ב־`signFromClick` הן יחסית לרכיב הווידאו (0,0 בפינה השמאלית העליונה של הווידאו, כמו `getBoundingClientRect`). אחרי מימוש, אם המבחן הראשון נכשל על `buildSignMenu.call` — לתקן את המבחן לעבוד דרך document גלובלי, לא לשנות את החוזה.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/signs-ui.test.ts`  
Expected: FAIL — המודול חסר. להוסיף `jsdom` כתלות פיתוח אם צריך.

- [ ] **Step 3: Write minimal implementation**

תפריט אופקי/גלילה עם 10 כפתורים גדולים + כפתור «מחק סימן». אחרי בחירת סימן (חוץ מ־«הערה»), הלחיצה הבאה על הווידאו מציבה אותו, שולחת בערוץ, ומציגה מקומית. ל־«הערה»: קודם שדה טקסט (עד 40), אז לחיצה על הווידאו. שכבת הסימן מעל ה־`<video>`, `pointer-events: none` על השכבה (הלחיצה נתפסת ב־video). אנימציה ב־CSS לפי `kind` (גלילה: שבבים זזים בכיוון; זום: שני קווים מתקרבים/מתרחקים; לחיצה: עיגול פועם). `hangup` מנקה סימן וסוגר.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- web/tests/signs-ui.test.ts`  
Expected: PASS. גם: `npm test` — כל המבחנים הקיימים עדיין ירוקים.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: תפריט סימני מחוות, הערה ומחיקה אצל הקרוב"
```

---

### Task 7: הגשת HTTPS ואיסוף האתר עם השרת

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/listen.ts`
- Create: `server/tests/listen.test.ts`
- Create: `scripts/dev.sh`
- Test: `server/tests/listen.test.ts`

**Interfaces:**
- Consumes: `attachSignaling`
- Produces:
  - `export function createApp(opts: { webRoot: string }): HttpServer` — מגיש את קבצי `web/dist` ב־`GET /`, נתיב `/ws` ל־WebSocket בלבד. אין API שמחזיר הקלטות או רשימת שיחות.
  - `export async function listenTls(app: HttpServer, opts: { cert: string; key: string; port: number }): Promise<{ url: string }>`
  - סקריפט `scripts/dev.sh`: בונה את האתר (`npm run build --workspace=web`), יוצר אישור מקומי לפיתוח אם חסר (למשל `mkcert` או openssl ל־localhost), מריץ את השרת. לבדיקה בשני טלפונים: הערה בסקריפט להרצת `cloudflared tunnel --url https://localhost:PORT` — בלי חשבון וبدون תשלום, ורק אם אביב מאשר את ההרצה. ברירת המחדל לא פותחת מנהרה לבד.

- [ ] **Step 1: Write the failing test**

מבחן: `createApp` עם תיקיית סטטיק זמנית שמכילה `index.html` עם המחרוזת `אני עוזר`; בקשת HTTP `GET /` מחזירה 200 ואת התוכן. בקשת `GET /ws` ב־HTTP רגיל לא מחזירה את קובץ האתר כטעות (שדרוג WS או 400+). אין נתיב `/recordings`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide && npm test -- server/tests/listen.test.ts`  
Expected: FAIL — `createApp` חסר.

- [ ] **Step 3: Write minimal implementation**

`index.ts` / `listen.ts` לפי הממשק. `package.json` בשורש: `"start": "npm run build --workspace=web && node --import tsx server/src/index.ts"`. פורט ברירת מחדל `8443`. בלי TURN.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide && npm test -- server/tests/listen.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ scripts/ package.json
git commit -m "feat: הגשת האתר ב־HTTPS יחד עם שרת התיאום"
```

---

### Task 8: אפליקציית אנדרואיד — יצירת שיחה, קוד, הרשאות

**Files:**
- Create: פרויקט Android סטנדרטי ב־`android/` (Gradle Kotlin DSL, `namespace app.familyguide.elder`, `applicationId app.familyguide.elder`, `minSdk 26`, `targetSdk 35`, שפה עברית, `android:supportsRtl="true"`)
- Create: `android/app/src/main/java/app/familyguide/elder/SessionClient.kt`
- Create: `android/app/src/main/java/app/familyguide/elder/MainActivity.kt`
- Create: `android/app/src/test/java/app/familyguide/elder/SessionClientTest.kt`
- Create: מסכי XML ב־RTL: קוד ב־6 ספרות גדולות, כפתור «אני צריך עזרה», חיווי מאוחר יותר ב־Task 10
- Test: `android/app/src/test/java/app/familyguide/elder/SessionClientTest.kt`

**Interfaces:**
- Consumes: אותו פרוטוקול JSON כמו `WsClientMessage` / `WsServerMessage` (ליישם `parse` בקוטלין שתואם בדיוק לשמות השדות מ־Task 1: `type`, `code`, `role`, `payload`)
- Produces:
  - `class SessionClient(private val wsFactory: (url: String) -> ClientSocket)` 
    - `suspend fun createSession(): String` — שולח `{"type":"create"}`, מחזיר את הקוד בן 6 ספרות, זורק אם אין `created`
    - `fun hangup()`
    - `fun sendSignal(payload: String)`
    - callbacks: `onPeerJoined`, `onSignal`, `onPeerLeft`, `onError`
  - `MainActivity`: לחיצה על «אני צריך עזרה» קוראת ל־`createSession` ומציגה את הקוד. לפני שיתוף מסך (Task 9) מבקשים את הרשאת השכבה «הצגה מעל אפליקציות אחרות» (`Settings.ACTION_MANAGE_OVERLAY_PERMISSION`) פעם אחת, והסבר קצר בעברית למה זה נחוץ. בלי הרשאה הזו — לא מתחילים שיחה, מציגים הסבר, לא עוקפים.

- [ ] **Step 1: Write the failing test**

מבחן JVM עם socket מזויף: כשמזרימים ללקוח את `{ "type":"created", "code":"654321" }` אחרי `create`, `createSession()` מחזיר `"654321"`. הודעת `{ "type":"error", "code":"invalid" }` מפעילה `onError("invalid")`. `hangup` שולח `{"type":"hangup"}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide/android && ./gradlew :app:testDebugUnitTest --tests app.familyguide.elder.SessionClientTest`  
Expected: FAIL — המחלקה חסרה. (אם Gradle עטיפה חסרה — ליצור wrapper באותה משימה.)

- [ ] **Step 3: Write minimal implementation**

`SessionClient.kt` + `MainActivity` לפי הממשק. טקסטים בעברית, RTL. אין שליטה במגע. אין שמירת שידור.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide/android && ./gradlew :app:testDebugUnitTest --tests app.familyguide.elder.SessionClientTest`  
Expected: PASS. מבחני JS/TS הקיימים נשארים ירוקים (`npm test` בשורש).

- [ ] **Step 5: Commit**

```bash
git add android/
git commit -m "feat: אפליקציית מבוגר — יצירת שיחה והצגת קוד"
```

---

### Task 9: אנדרואיד — שיתוף מסך ב־WebRTC בלי שמע

**Files:**
- Create: `android/app/src/main/java/app/familyguide/elder/ScreenShareService.kt`
- Create: `android/app/src/main/java/app/familyguide/elder/ElderPeer.kt`
- Create: `android/app/src/test/java/app/familyguide/elder/ElderPeerTest.kt`
- Modify: `AndroidManifest.xml` — `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `INTERNET`, שירות מסוג mediaProjection (כפי שנדרש ב־API הנוכחי). אין הרשאות שמע.
- Test: `android/app/src/test/java/app/familyguide/elder/ElderPeerTest.kt`

**Interfaces:**
- Consumes: `SessionClient.sendSignal` / `onSignal`, `STUN_URL` (אותו ערך: `stun:stun.l.google.com:19302`), `SIGNS_CHANNEL = "signs"`
- Produces:
  - `class ElderPeer` — יוצר `PeerConnection` עם STUN בלבד, בלי audio track ובלי TURN. אחרי `onPeerJoined`, מקבל `MediaProjection` (מה־Activity, Intent של המשתמש), מתחיל `ScreenShareService` (foreground, התראה קבועה בעברית «משתפים את המסך»), יוצר offer, פותח `DataChannel` בשם `signs`. `onSignsMessage: (json: String) -> Unit`. `hangup()` עוצר שירות, סוגר peer, קורא ל־`SessionClient.hangup()`. כישלון ICE: הודעה בעברית זהה לצד הקרוב («לא הצלחנו להתחבר ישירות…»), בלי TURN.

- [ ] **Step 1: Write the failing test**

מבחן יחידה ל־`ElderPeer` עם `PeerConnection` מזויף / wrapper: מוודא שרשימת `IceServer` מכילה רק את ה־STUN שאושר; `createOffer` לא מוסיף audio; נפתח ערוץ בשם בדיוק `signs`; `hangup` סוגר את הערוץ ואת החיבור.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide/android && ./gradlew :app:testDebugUnitTest --tests app.familyguide.elder.ElderPeerTest`  
Expected: FAIL — המחלקה חסרה.

- [ ] **Step 3: Write minimal implementation**

ספריית WebRTC: `io.getstream:stream-webrtc-android` (גרסה יציבה אחרונה בזמן המימוש). `ScreenShareService` כשירות חובה ל־MediaProjection; אם המשתמש מסרב לשיתוף מסך — לא מתחילים שיחה, מציגים «צריך לאשר שיתוף מסך כדי שהקרוב יוכל לראות.», והקוד לא נשאר שמיש (קוראים ל־`end` / `hangup`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/family-phone-guide/android && ./gradlew :app:testDebugUnitTest --tests app.familyguide.elder.ElderPeerTest`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/
git commit -m "feat: שיתוף מסך מהמבוגר ב־WebRTC בלי שמע"
```

---

### Task 10: שכבת סימנים, חיווי «רואים את המסך», וסיום אצל המבוגר

**Files:**
- Create: `android/app/src/main/java/app/familyguide/elder/SignOverlay.kt`
- Create: `android/app/src/main/java/app/familyguide/elder/SignMapper.kt`
- Create: `android/app/src/test/java/app/familyguide/elder/SignMapperTest.kt`
- Create: `android/app/src/test/java/app/familyguide/elder/SignOverlayParseTest.kt`
- Modify: `MainActivity.kt`, מניפסט (`SYSTEM_ALERT_WINDOW` כבר טופל בהרשאה ב־Task 8)
- Test: `android/app/src/test/java/app/familyguide/elder/SignMapperTest.kt`, `SignOverlayParseTest.kt`

**Interfaces:**
- Consumes: אותו JSON של `SignPayload` / `clear_sign` / `hangup` מ־Task 1 (שמות שדות זהים, `kind` זהה, תוויות עברית זהות)
- Produces:
  - `object SignMapper { fun toPixels(x: Float, y: Float, width: Int, height: Int): Pair<Int, Int> }` — `x=0,y=0` לפינה השמאלית העליונה של המסך, `x=1,y=1` לימנית התחתונה; ערכים מחוץ ל־0..1 נחתכים
  - `fun parseChannelMessage(json: String): ChannelMsg?` כאשר `ChannelMsg` הוא `Sign`, `Clear`, או `Hangup`; דחייה של הודעות שליטה (למשל `"remote_tap"`) מחזירה `null` ולא מבצעת מגע
  - `class SignOverlay` — חלון `TYPE_APPLICATION_OVERLAY`: (1) פס חיווי קבוע שאי אפשר להסתיר, עם הטקסט «רואים את המסך» וכפתור גדול «סיום»; לחיצה על סיום או על ניסיון לסגור את הפס = `hangup`, לא הסתרה; (2) סימן אחד עם התווית בעברית ואנימציה לפי `kind`; סימן חדש מחליף קודם; `clear_sign` מסיר סימן אבל משאיר את פס החיווי; `hangup` או `peer-left` מסירים הכול וסוגרים את השכבה
  - השכבה `not touchable` לסימן עצמו (לא בולעת לחיצות של המבוגר). הפס התחתון/עליון של «סיום» כן קליקבילי.

- [ ] **Step 1: Write the failing test**

```kotlin
// SignMapperTest.kt
assertEquals(Pair(0, 0), SignMapper.toPixels(0f, 0f, 1000, 2000))
assertEquals(Pair(1000, 2000), SignMapper.toPixels(1f, 1f, 1000, 2000))
assertEquals(Pair(250, 500), SignMapper.toPixels(0.25f, 0.25f, 1000, 2000))
assertEquals(Pair(0, 2000), SignMapper.toPixels(-1f, 2f, 1000, 2000))

// SignOverlayParseTest.kt
assertTrue(parseChannelMessage("""{"type":"sign","kind":"scroll_down","x":0.5,"y":0.4}""") is ChannelMsg.Sign)
assertEquals("גלול למטה", (parseChannelMessage("""{"type":"sign","kind":"scroll_down","x":0.5,"y":0.4}""") as ChannelMsg.Sign).label)
assertTrue(parseChannelMessage("""{"type":"clear_sign"}""") is ChannelMsg.Clear)
assertEquals(null, parseChannelMessage("""{"type":"remote_tap","x":0.5,"y":0.5}"""))
assertEquals(null, parseChannelMessage("""{"type":"sign","kind":"note","x":0.1,"y":0.1,"text":"${"א".repeat(41)}"}"""))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/family-phone-guide/android && ./gradlew :app:testDebugUnitTest --tests app.familyguide.elder.SignMapperTest --tests app.familyguide.elder.SignOverlayParseTest`  
Expected: FAIL — המחלקות חסרות.

- [ ] **Step 3: Write minimal implementation**

תוויות משוכפלות בדיוק מ־`SIGN_LABELS` (אותן עשר מחרוזות). אין חיבור ל־Accessibility שמבצע מגע. בנייה: `./gradlew :app:assembleDebug` מייצר APK ב־`android/app/build/outputs/apk/debug/app-debug.apk` להתקנה ידנית.

- [ ] **Step 4: Run test to verify it passes**

Run: אותה פקודת Gradle, Expected: PASS. גם `npm test` בשורש ירוק.

- [ ] **Step 5: Commit**

```bash
git add android/
git commit -m "feat: שכבת סימנים וחיווי גלוי אצל המבוגר, בלי שליטה במגע"
```

---

### Task 11: בדיקת קצה־אל־קצה לפי קריטריון ההצלחה

**Files:**
- Create: `docs/superpowers/plans/manual-test-checklist.md` (עברית, RTL) — רשימת בדיקה מעשית בלבד, לא קוד ייצור חדש
- Modify: תיקוני באגים שיתגלו, בקבצים הקיימים בלבד
- Test: `npm test` + `./gradlew :app:testDebugUnitTest` + הרשימה למטה על שני טלפונים

**Interfaces:**
- Consumes: המערכת המלאה מ־Tasks 1–10
- Produces: רשימת בדיקה שעברה, ו־APK + כתובת אתר לבדיקה. אין תשלום, אין TURN, אין חנות.

- [ ] **Step 1: Write the checklist** (בעברית, בתיבה מסומנת לכל פריט מהמפרט)

פריטים חובה — כולם חייבים לעבור לפני שמכריזים שהאב-טיפוס מוכן:

1. מבוגר באנדרואיד יוצר קוד; קרוב באייפון או באנדרואיד נכנס מהאתר ורואה את המסך.
2. הקרוב מציב מהתפריט «לחץ כאן», «גלול למטה» ו«זום פנימה»; כל סימן מופיע על מסך המבוגר עם המילה בעברית והתנועה.
3. אפשר להחליף סימן, למחוק אותו בלי לסיים שיחה, ולהוסיף הערה עד 40 תווים (הערה של 41 נדחית).
4. המבוגר יכול לבצע את המחווה בעצמו; הסימן לא מגלל ולא לוחץ בשבילו.
5. פס «רואים את המסך» גלוי ואי אפשר להסתיר אותו בלי סיום.
6. סיום מכל צד מנתק, מסיר סימנים, והקוד לא עובד אחרי זה.
7. קוד שגוי, קוד שפג (אחרי 10 דקות בלי הצטרפות — אפשר לדמות בשעון בדיקות), קרוב שני, וסירוב לשיתוף מסך — כולם הודעה ברורה.
8. ניתוק באמצע מציג «השיחה נגמרה» בצד השני.
9. מבוגר עם אייפון שנכנס לאתר מקבל הסבר ישר (אנדרואיד בלבד).
10. אין שמע בשיחה, ואין קבצי הקלטה בשרת.
11. אם החיבור הישיר נכשל — הודעת השגיאה שאושרה, בלי ממסר בתשלום.

- [ ] **Step 2: Run automated tests**

Run: `cd /workspace/family-phone-guide && npm test && cd android && ./gradlew :app:testDebugUnitTest`  
Expected: PASS, בלי מבחנים מדולגים שקשורים לדרישות למעלה.

- [ ] **Step 3: Run the two-phone manual checklist**

מבוגר באנדרואיד עם ה־APK, קרוב בדפדפן (עדיף מכשיר שני, כולל אייפון). לסמן כל פריט ברשימה. אם פריט נכשל — לתקן במינימום, להוסיף מבחן יחידה שתופס את הבאג אם אפשר, ולבצע שוב את הפריט.

- [ ] **Step 4: Commit checklist results only after the required items pass**

```bash
git add docs/superpowers/plans/manual-test-checklist.md
git commit -m "test: רשימת בדיקה מעשית לאב-טיפוס הסיוע המשפחתי"
```

---

## סקירת כיסוי מול המפרט

| דרישה במפרט | משימה |
|---|---|
| תפריט 10 סימנים, עברית, אנימציה, הערה 40, סימן אחד, מחיקה | 1, 6, 10 |
| קוד 6 ספרות, 10 דקות, קרוב אחד, הגבלת ניחושים | 2, 3 |
| שידור P2P, בלי שמע, STUN בלבד, שגיאה בלי TURN | 5, 9 |
| סימנים אצל הקרוב ואצל המבוגר באנדרואיד | 6, 10 |
| חיווי גלוי, סיום משני הצדדים, קוד מתבטל, בלי הקלטה | 3, 8, 10 |
| בלי שליטה במגע | 6, 10 (דחיית remote_tap) |
| הסבר למבוגר באייפון | 4 |
| APK לבדיקה, בלי חנות, הרשאת שכבה פעם אחת | 8, 10 |
| HTTPS, בדיקה בשני טלפונים | 7, 11 |
| תשלום, חשבונות, דיבור, צימוד קבוע, אפליקציית אייפון למבוגר, TURN בתשלום | לא נבנים |

אין במסמך TBD או «לממש אחר כך». שמות השדות (`type`, `kind`, `signs`, קודי השגיאה, תוויות העברית, כתובת ה־STUN) אחידים בכל המשימות.

</div>
