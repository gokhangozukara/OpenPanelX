import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, type Role, type UserRow } from "./db";
import {
  RANK,
  appSecret,
  clearFailures,
  hasRole,
  hashPassword,
  noteFailure,
  packToken,
  tooManyAttempts,
  unpackToken,
  verifyPassword,
} from "./security";

export { appSecret, clearFailures, hasRole, hashPassword, noteFailure, tooManyAttempts, verifyPassword };

const COOKIE = "opx_session";
const MAX_AGE = 60 * 60 * 24 * 7;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
  secure: process.env.NODE_ENV === "production" && process.env.OPENPANELX_INSECURE !== "1",
});

// Between the password step and the code step the person is not signed in yet. This short-lived,
// separately named and typed cookie only lets them reach the code page; it never counts as a session.
const PENDING = "opx_pending";
export async function startPending(userId: number) {
  (await cookies()).set(PENDING, packToken("pending", userId, 0, 5 * 60_000), cookieOptions(300));
}
export async function getPending(): Promise<number | null> {
  return unpackToken((await cookies()).get(PENDING)?.value, "pending")?.userId ?? null;
}
export async function clearPending() {
  (await cookies()).set(PENDING, "", { path: "/", maxAge: 0 });
}

export async function startSession(userId: number, sessionVersion?: number) {
  const version =
    sessionVersion ??
    ((db.prepare("SELECT session_version FROM users WHERE id = ?").get(userId) as { session_version: number } | undefined)
      ?.session_version ??
      1);
  (await cookies()).set(COOKIE, packToken("session", userId, version, MAX_AGE * 1000), cookieOptions(MAX_AGE));
}

export async function endSession() {
  (await cookies()).set(COOKIE, "", { path: "/", maxAge: 0 });
}

/** Returns the signed-in user, re-checked against the database and session_version on every request. */
export async function getUser(): Promise<UserRow | null> {
  const token = unpackToken((await cookies()).get(COOKIE)?.value, "session");
  if (!token) return null;
  const user =
    (db
      .prepare("SELECT id, username, role, created_at, totp_enabled, session_version FROM users WHERE id = ?")
      .get(token.userId) as UserRow | undefined) ?? null;
  if (!user || user.session_version !== token.version) return null;
  return user;
}

export async function requireUser(min: Role = "viewer"): Promise<UserRow> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (RANK[user.role] < RANK[min]) redirect("/?denied=1");
  return user;
}

export const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
