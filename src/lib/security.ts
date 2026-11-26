import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, getDataDir } from "./db";

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX = 5;

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

const sign = (body: string) => createHmac("sha256", appSecret()).update(body).digest("base64url");

export function packToken(userId: number, version: number, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ u: userId, v: version, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function unpackToken(raw: string | undefined): { userId: number; version: number } | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const good = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { u?: unknown; v?: unknown; exp?: unknown };
    if (
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

/** Persistent SQLite brake against password/2FA guessing: 5 failures per 15 minutes per key. */
export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  db.prepare("DELETE FROM rate_limits WHERE until <= ?").run(now);
  const row = db.prepare("SELECT count, until FROM rate_limits WHERE key = ?").get(key) as
    | { count: number; until: number }
    | undefined;
  return !!row && row.until > now && row.count >= RATE_LIMIT_MAX;
}

export function noteFailure(key: string): void {
  const now = Date.now();
  const nextUntil = now + RATE_LIMIT_WINDOW_MS;
  db.prepare(
    `INSERT INTO rate_limits (key, count, until) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.until <= ? THEN 1 ELSE rate_limits.count + 1 END,
       until = CASE WHEN rate_limits.until <= ? THEN ? ELSE rate_limits.until END`
  ).run(key, nextUntil, now, now, nextUntil);
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
