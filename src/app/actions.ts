"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  clearFailures,
  clearPending,
  endSession,
  getPending,
  hasRole,
  hashPassword,
  noteFailure,
  requireUser,
  startPending,
  startSession,
  tooManyAttempts,
  userCount,
  verifyPassword,
} from "@/lib/auth";
import { audit, db, type Role } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { getPlugin, saveRows, tableRows, type Row } from "@/lib/plugins";
import { checkTotp, hashRecovery, newRecoveryCodes, newTotpSecret, open, seal } from "@/lib/totp";

export type FormState = { error?: string; ok?: string; codes?: string[] } | undefined;

const NAME = /^[A-Za-z0-9._-]{3,32}$/;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isRole = (v: string): v is Role => v === "admin" || v === "editor" || v === "viewer";

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const username = str(form, "username");
  const password = String(form.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}|${username.toLowerCase()}`;
  if (tooManyAttempts(key)) return { error: t("tooMany") };

  const row = db
    .prepare("SELECT id, password_hash, totp_enabled FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as { id: number; password_hash: string; totp_enabled: number } | undefined;
  // Hash even when the user does not exist so timing does not reveal which usernames are real.
  const ok = row ? verifyPassword(password, row.password_hash) : (verifyPassword(password, "scrypt$00$00"), false);
  if (!row || !ok) {
    noteFailure(key);
    audit(null, "login.failed", username);
    return { error: t("invalid") };
  }
  clearFailures(key);
  if (row.totp_enabled) {
    // Right password, but the second step is still missing. No session yet.
    await startPending(row.id);
    redirect("/login/verify");
  }
  await startSession(row.id);
  audit(username, "login");
  redirect("/");
}

export async function verifyLogin(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const id = await getPending();
  if (id === null) redirect("/login");
  const key = `2fa|${id}`;
  if (tooManyAttempts(key)) return { error: t("tooMany") };

  const user = db.prepare("SELECT id, username, totp_secret, totp_step FROM users WHERE id = ? AND totp_enabled = 1").get(id) as
    | { id: number; username: string; totp_secret: string; totp_step: number }
    | undefined;
  if (!user) redirect("/login");

  const entered = String(form.get("code") ?? "").trim();
  const secretPlain = open(user.totp_secret);
  const step = secretPlain ? checkTotp(secretPlain, entered, user.totp_step) : null;
  if (step !== null) {
    db.prepare("UPDATE users SET totp_step = ? WHERE id = ?").run(step, user.id);
  } else {
    // Not a valid app code: maybe a one-time recovery code.
    const hit = db
      .prepare("SELECT id FROM recovery_codes WHERE user_id = ? AND used = 0 AND code_hash = ?")
      .get(user.id, hashRecovery(entered)) as { id: number } | undefined;
    if (!hit) {
      noteFailure(key);
      audit(user.username, "login.2fa-failed");
      return { error: t("codeWrong") };
    }
    db.prepare("UPDATE recovery_codes SET used = 1 WHERE id = ?").run(hit.id);
    audit(user.username, "login.recovery-code");
  }
  clearFailures(key);
  await clearPending();
  await startSession(user.id);
  audit(user.username, "login");
  redirect("/");
}

export async function startTotpSetup() {
  const me = await requireUser();
  if (me.totp_enabled) return;
  db.prepare("UPDATE users SET totp_secret = ?, totp_step = 0 WHERE id = ?").run(seal(newTotpSecret()), me.id);
  revalidatePath("/settings");
}

export async function cancelTotpSetup() {
  const me = await requireUser();
  if (!me.totp_enabled) db.prepare("UPDATE users SET totp_secret = NULL WHERE id = ?").run(me.id);
  revalidatePath("/settings");
}

export async function confirmTotp(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const { t } = await getT();
  const row = db.prepare("SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 0").get(me.id) as { totp_secret: string | null } | undefined;
  const secretPlain = row?.totp_secret ? open(row.totp_secret) : null;
  if (!secretPlain) return { error: t("invalid") };
  const step = checkTotp(secretPlain, String(form.get("code") ?? ""), 0);
  if (step === null) return { error: t("codeWrong") };

  const codes = newRecoveryCodes();
  db.prepare("UPDATE users SET totp_enabled = 1, totp_step = ? WHERE id = ?").run(step, me.id);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(me.id);
  const ins = db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)");
  for (const c of codes) ins.run(me.id, hashRecovery(c));
  audit(me.username, "2fa.enable");
  // No revalidate here on purpose: the page must keep showing the recovery codes until the person leaves.
  return { ok: t("twoFactorOn"), codes };
}

export async function disableTotp(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const { t } = await getT();
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id) as { password_hash: string };
  if (!verifyPassword(String(form.get("password") ?? ""), row.password_hash)) return { error: t("pwWrong") };
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_step = 0 WHERE id = ?").run(me.id);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(me.id);
  audit(me.username, "2fa.disable");
  revalidatePath("/settings");
  return { ok: t("saved") };
}

/** Admin help for someone who lost their phone and recovery codes. */
export async function resetUserTotp(form: FormData) {
  const me = await requireUser("admin");
  const id = Number(form.get("id"));
  const target = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as { username: string } | undefined;
  if (!target || id === me.id) return;
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_step = 0 WHERE id = ?").run(id);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(id);
  audit(me.username, "2fa.reset", target.username);
  revalidatePath("/users");
}

export async function setupAdmin(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  if (userCount() > 0) redirect("/login"); // setup is only possible while the panel is empty
  const username = str(form, "username");
  const password = String(form.get("password") ?? "");
  if (!NAME.test(username)) return { error: t("userBad") };
  if (password.length < 8) return { error: t("pwShort") };
  const res = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .run(username, hashPassword(password));
  await startSession(Number(res.lastInsertRowid));
  audit(username, "setup", "first admin created");
  redirect("/");
}

export async function signOut() {
  await endSession();
  redirect("/login");
}

export async function addUser(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser("admin");
  const { t } = await getT();
  const username = str(form, "username");
  const password = String(form.get("password") ?? "");
  const role = str(form, "role");
  if (!NAME.test(username)) return { error: t("userBad") };
  if (password.length < 8) return { error: t("pwShort") };
  if (!isRole(role)) return { error: t("invalid") };
  try {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(username, hashPassword(password), role);
  } catch {
    return { error: t("userExists") };
  }
  audit(me.username, "user.add", `${username} (${role})`);
  revalidatePath("/users");
  return { ok: t("saved") };
}

export async function deleteUser(form: FormData) {
  const me = await requireUser("admin");
  const id = Number(form.get("id"));
  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id) as
    | { id: number; username: string; role: Role }
    | undefined;
  if (!target || target.id === me.id) return;
  if (target.role === "admin") {
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
    if (admins <= 1) return;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  audit(me.username, "user.delete", target.username);
  revalidatePath("/users");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const { t } = await getT();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id) as { password_hash: string };
  if (!verifyPassword(current, row.password_hash)) return { error: t("pwWrong") };
  if (next.length < 8) return { error: t("pwShort") };
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), me.id);
  audit(me.username, "password.change");
  return { ok: t("saved") };
}

const MAX_ROWS = 1000;
const MAX_CELL = 500;

function editableTable(plugin: ReturnType<typeof getPlugin>, index: number) {
  const s = plugin?.sections[index];
  return s && s.type === "table" && s.editable ? s : null;
}

export async function addRow(pluginId: string, index: number, _: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser("editor");
  const { t } = await getT();
  const plugin = getPlugin(pluginId);
  const table = editableTable(plugin, index);
  if (!plugin || !table || !hasRole(me, plugin.minRole)) return { error: t("invalid") };

  const row: Row = { _id: randomUUID() };
  for (const col of table.columns) row[col.key] = String(form.get(col.key) ?? "").trim().slice(0, MAX_CELL);
  if (table.columns.every((c) => row[c.key] === "")) return { error: t("rowEmpty") };

  const rows = tableRows(plugin, table, index);
  if (rows.length >= MAX_ROWS) return { error: t("rowLimit") };
  saveRows(plugin, index, [...rows, row]);
  audit(me.username, "row.add", plugin.id);
  revalidatePath(`/plugins/${plugin.id}`);
  return { ok: t("saved") };
}

export async function deleteRow(pluginId: string, index: number, form: FormData) {
  const me = await requireUser("editor");
  const plugin = getPlugin(pluginId);
  const table = editableTable(plugin, index);
  if (!plugin || !table || !hasRole(me, plugin.minRole)) return;
  const rowId = String(form.get("rowId") ?? "");
  saveRows(plugin, index, tableRows(plugin, table, index).filter((r) => r._id !== rowId));
  audit(me.username, "row.delete", plugin.id);
  revalidatePath(`/plugins/${plugin.id}`);
}

export async function setLanguage(form: FormData) {
  const v = str(form, "lang");
  if (v === "en" || v === "tr" || v === "de") {
    (await cookies()).set("oha_lang", v, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  revalidatePath("/", "layout");
}
