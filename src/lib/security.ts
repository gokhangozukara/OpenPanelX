import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, getDataDir, type Role, type UserRow } from "./db";

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX = 5;
export const DEFAULT_ACCOUNT_MAX = 20;
export const MAX_LOGIN_QUEUE_WAIT_MS = 4000;
export const MAX_RATE_LIMIT_ROWS = 5000;
const KNOWN_USER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type TokenType = "session" | "pending";
export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
export const hasRole = (user: Pick<UserRow, "role">, min: Role) => RANK[user.role] >= RANK[min];

export function appSecret(): string {
  if (process.env.OPENPANELX_SECRET) return process.env.OPENPANELX_SECRET;
  const dir = getDataDir();
  const file = path.join(dir, "secret");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const signDomain = (domain: string, body: string) =>
  createHmac("sha256", appSecret()).update(`${domain}.${body}`).digest("base64url");

export function packToken(typ: TokenType, userId: number, version: number, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ typ, u: userId, v: version, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${signDomain(typ, body)}`;
}

export function unpackToken(raw: string | undefined, expectedType: TokenType): { userId: number; version: number } | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const good = Buffer.from(signDomain(expectedType, body));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      typ?: unknown;
      u?: unknown;
      v?: unknown;
      exp?: unknown;
    };
    if (
      parsed.typ === expectedType &&
      typeof parsed.u === "number" &&
      typeof parsed.v === "number" &&
      typeof parsed.exp === "number" &&
      parsed.exp > Date.now()
    ) {
      return { userId: parsed.u, version: parsed.v };
    }
    return null;
  } catch {
    return null;
  }
}

const hashUsername = (username: string) =>
  createHash("sha256").update(username.trim().toLowerCase()).digest("hex");

/** Signs a non-session marker proving this browser previously signed in as `username`. */
export function packKnownUser(username: string, ttlMs = KNOWN_USER_TTL_MS): string {
  const body = Buffer.from(
    JSON.stringify({ typ: "known", h: hashUsername(username), exp: Date.now() + ttlMs }),
  ).toString("base64url");
  return `${body}.${signDomain("known", body)}`;
}

export function verifyKnownUser(raw: string | undefined, username: string): boolean {
  if (!raw || !username.trim()) return false;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return false;
  const good = Buffer.from(signDomain("known", body));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      typ?: unknown;
      h?: unknown;
      exp?: unknown;
    };
    if (parsed.typ !== "known" || typeof parsed.h !== "string" || typeof parsed.exp !== "number" || parsed.exp <= Date.now()) {
      return false;
    }
    const expected = Buffer.from(hashUsername(username), "utf8");
    const actual = Buffer.from(parsed.h, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Reads client IP from proxy headers only when OPENPANELX_TRUST_PROXY=1 is explicitly set. */
export function clientIpFromHeaders(
  h: Pick<Headers, "get">,
  trustProxy = process.env.OPENPANELX_TRUST_PROXY === "1",
): string | null {
  if (!trustProxy) return null;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = h.get("x-real-ip")?.trim();
  return realIp || null;
}

/** Spacing between consecutive sign-in attempts for the same account. */
export function loginStepMs(failures: number): number {
  if (failures < 3) return 200;
  return Math.min(3000, 250 * 2 ** (failures - 3));
}

/** Persistent SQLite brake against password/2FA guessing: `maxAttempts` failures per 15 minutes per key. */
export function getFailureCount(key: string): number {
  const now = Date.now();
  db.prepare("DELETE FROM rate_limits WHERE until <= ? AND next_at <= ?").run(now, now);
  const row = db.prepare("SELECT count, until FROM rate_limits WHERE key = ?").get(key) as
    | { count: number; until: number }
    | undefined;
  return row && row.until > now ? row.count : 0;
}

export function tooManyAttempts(key: string, maxAttempts = RATE_LIMIT_MAX): boolean {
  return getFailureCount(key) >= maxAttempts;
}

function enforceRateLimitCap(maxRows = MAX_RATE_LIMIT_ROWS): void {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM rate_limits").get() as { n: number }).n;
  if (total < maxRows) return;
  const excess = total - maxRows + 1;
  db.prepare(
    `DELETE FROM rate_limits WHERE key IN (
       SELECT key FROM rate_limits ORDER BY count ASC, until ASC LIMIT ?
     )`,
  ).run(excess);
}

/**
 * Atomically reserves an exclusive execution slot for a sign-in attempt in SQLite.
 * Serializes concurrent requests so parallel bursts cannot bypass pacing, rejects overflow
 * requests immediately without invoking scrypt, and enforces an optional hard ceiling.
 */
export function reserveLoginSlot(
  key: string,
  opts?: { hardMax?: number; maxQueueWaitMs?: number; maxRows?: number; now?: number },
): { allowed: boolean; waitMs: number; count: number } {
  const now = opts?.now ?? Date.now();
  const maxQueueWaitMs = opts?.maxQueueWaitMs ?? MAX_LOGIN_QUEUE_WAIT_MS;
  const hardMax = opts?.hardMax;
  const maxRows = opts?.maxRows ?? MAX_RATE_LIMIT_ROWS;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM rate_limits WHERE until <= ? AND next_at <= ?").run(now, now);
    const row = db.prepare("SELECT count, until, next_at FROM rate_limits WHERE key = ?").get(key) as
      | { count: number; until: number; next_at: number }
      | undefined;

    const activeCount = row && row.until > now ? row.count : 0;
    const activeUntil = row && row.until > now ? row.until : now + RATE_LIMIT_WINDOW_MS;

    if (hardMax !== undefined && activeCount >= hardMax) {
      db.exec("COMMIT");
      return { allowed: false, waitMs: 0, count: activeCount };
    }

    const prevNextAt = row ? row.next_at : 0;
    const runAt = Math.max(now, prevNextAt);
    const waitMs = runAt - now;
    if (waitMs > maxQueueWaitMs) {
      db.exec("COMMIT");
      return { allowed: false, waitMs, count: activeCount };
    }

    if (!row) enforceRateLimitCap(maxRows);

    const nextAt = runAt + loginStepMs(activeCount);
    db.prepare(
      `INSERT INTO rate_limits (key, count, until, next_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = excluded.count, until = excluded.until, next_at = excluded.next_at`,
    ).run(key, activeCount, activeUntil, nextAt);

    db.exec("COMMIT");
    return { allowed: true, waitMs, count: activeCount };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

export function noteFailure(key: string, now = Date.now(), maxRows = MAX_RATE_LIMIT_ROWS): void {
  const nextUntil = now + RATE_LIMIT_WINDOW_MS;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM rate_limits WHERE until <= ? AND next_at <= ?").run(now, now);
    const row = db.prepare("SELECT count, until, next_at FROM rate_limits WHERE key = ?").get(key) as
      | { count: number; until: number; next_at: number }
      | undefined;
    if (!row) enforceRateLimitCap(maxRows);
    const nextCount = !row || row.until <= now ? 1 : row.count + 1;
    const until = !row || row.until <= now ? nextUntil : row.until;
    const nextAt = Math.max(row?.next_at ?? 0, now + loginStepMs(nextCount));
    db.prepare(
      `INSERT INTO rate_limits (key, count, until, next_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = excluded.count, until = excluded.until, next_at = excluded.next_at`,
    ).run(key, nextCount, until, nextAt);
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

export function clearFailures(key: string): void {
  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
}

/** Checks that a cookie-authenticated API mutation originates from the same host. */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const expectedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return !!expectedHost && originHost === expectedHost;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      return !!expectedHost && refererHost === expectedHost;
    } catch {
      return false;
    }
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  return Boolean(request.headers.get("x-requested-with")) || contentType.startsWith("application/json");
}
