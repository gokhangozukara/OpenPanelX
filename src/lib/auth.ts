import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dataDir, db, type Role, type UserRow } from "./db";

const COOKIE = "oha_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function appSecret(): string {
  if (process.env.OPENHUBADMIN_SECRET) return process.env.OPENHUBADMIN_SECRET;
  const file = path.join(dataDir, "secret");
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

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
  secure: process.env.NODE_ENV === "production" && process.env.OPENHUBADMIN_INSECURE !== "1",
});

function pack(userId: number, ttlMs: number) {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unpack(raw: string | undefined): number | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const good = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof u === "number" && typeof exp === "number" && exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}

// Between the password step and the code step the person is not signed in yet. This short-lived,
// separately named cookie only lets them reach the code page; it never counts as a session.
const PENDING = "oha_pending";
export async function startPending(userId: number) {
  (await cookies()).set(PENDING, pack(userId, 5 * 60_000), cookieOptions(300));
}
export async function getPending(): Promise<number | null> {
  return unpack((await cookies()).get(PENDING)?.value);
}
export async function clearPending() {
  (await cookies()).set(PENDING, "", { path: "/", maxAge: 0 });
}

export async function startSession(userId: number) {
  (await cookies()).set(COOKIE, pack(userId, MAX_AGE * 1000), cookieOptions(MAX_AGE));
}

export async function endSession() {
  (await cookies()).set(COOKIE, "", { path: "/", maxAge: 0 });
}

/** Returns the signed-in user, re-checked against the database on every request. */
export async function getUser(): Promise<UserRow | null> {
  const id = unpack((await cookies()).get(COOKIE)?.value);
  if (id === null) return null;
  return (db.prepare("SELECT id, username, role, created_at, totp_enabled FROM users WHERE id = ?").get(id) as UserRow) ?? null;
}

export async function requireUser(min: Role = "viewer"): Promise<UserRow> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (RANK[user.role] < RANK[min]) redirect("/?denied=1");
  return user;
}

export const hasRole = (user: Pick<UserRow, "role">, min: Role) => RANK[user.role] >= RANK[min];
export const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

// Tiny in-memory brake against password guessing: 5 failures per 15 minutes per key.
const fails = new Map<string, { n: number; until: number }>();
export function tooManyAttempts(key: string) {
  const f = fails.get(key);
  return !!f && f.until > Date.now() && f.n >= 5;
}
export function noteFailure(key: string) {
  const f = fails.get(key);
  fails.set(key, !f || f.until < Date.now() ? { n: 1, until: Date.now() + 15 * 60_000 } : { n: f.n + 1, until: f.until });
}
export function clearFailures(key: string) {
  fails.delete(key);
}
