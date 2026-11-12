import crypto from "node:crypto";

export const CODE_LENGTH = 6;
export const UNUSED_TTL_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const MAX_CREATE_ATTEMPTS = 100;

export function generateSessionCode(randomDigit: () => number = () => crypto.randomInt(0, 10)): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String(randomDigit());
  }
  return code;
}

export function isValidCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export type JoinError = "invalid" | "expired" | "already_joined" | "rate_limited";
export type JoinOk = { ok: true; session: Session };
export type JoinFail = { ok: false; error: JoinError };
// creatorClientId: the elder's client id (rate-limit bucket), used so a client
// cannot clear its own failed joins by creating and joining its own session.
export type Session = { code: string; createdAt: number; helperJoined: boolean; creatorClientId?: string };

export class SessionStore {
  private readonly now: () => number;
  private readonly sessions = new Map<string, Session>();
  private readonly failures = new Map<string, number[]>();

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? Date.now;
  }

  create(creatorClientId?: string): Session {
    this.sweepExpired();
    let code = generateSessionCode();
    let attempts = 1;
    while (this.sessions.has(code)) {
      if (attempts >= MAX_CREATE_ATTEMPTS) {
        throw new Error(`SessionStore.create: no free session code after ${MAX_CREATE_ATTEMPTS} attempts`);
      }
      code = generateSessionCode();
      attempts++;
    }
    const session: Session = {
      code,
      createdAt: this.now(),
      helperJoined: false,
      creatorClientId,
    };
    this.sessions.set(code, session);
    return session;
  }

  join(code: string, clientId: string): JoinOk | JoinFail {
    const now = this.now();
    if (this.failureCount(clientId, now) >= RATE_LIMIT_MAX) {
      return { ok: false, error: "rate_limited" };
    }

    const session = this.sessions.get(code);
    if (!isValidCodeFormat(code) || !session) {
      this.recordFailure(clientId, now);
      return { ok: false, error: "invalid" };
    }

    if (now - session.createdAt > UNUSED_TTL_MS && session.helperJoined === false) {
      this.recordFailure(clientId, now);
      this.sessions.delete(code);
      return { ok: false, error: "expired" };
    }

    if (session.helperJoined) {
      return { ok: false, error: "already_joined" };
    }

    session.helperJoined = true;
    // Reset only for joining someone else's session; with no stored creator, don't.
    if (session.creatorClientId !== undefined && session.creatorClientId !== clientId) {
      this.failures.delete(clientId);
    }
    return { ok: true, session };
  }

  end(code: string): void {
    this.sessions.delete(code);
  }

  get(code: string): Session | undefined {
    const session = this.sessions.get(code);
    if (!session) return undefined;
    if (this.isUnusedExpired(session)) {
      this.sessions.delete(code);
      return undefined;
    }
    return session;
  }

  hasHelper(code: string): boolean {
    return this.get(code)?.helperJoined === true;
  }

  private sweepExpired(): void {
    for (const [code, session] of this.sessions) {
      if (this.isUnusedExpired(session)) this.sessions.delete(code);
    }
  }

  private isUnusedExpired(session: Session): boolean {
    return session.helperJoined === false && this.now() - session.createdAt > UNUSED_TTL_MS;
  }

  private failureCount(clientId: string, now: number): number {
    const recent = (this.failures.get(clientId) ?? []).filter(
      (t) => now - t <= RATE_LIMIT_WINDOW_MS,
    );
    if (recent.length === 0) {
      this.failures.delete(clientId);
    } else {
      this.failures.set(clientId, recent);
    }
    return recent.length;
  }

  private recordFailure(clientId: string, now: number): void {
    const recent = (this.failures.get(clientId) ?? []).filter(
      (t) => now - t <= RATE_LIMIT_WINDOW_MS,
    );
    recent.push(now);
    this.failures.set(clientId, recent);
  }
}
