import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const dataDir = process.env.OPENPANELX_DATA ?? path.join(process.cwd(), "data");

declare global {
  var __opxDb: DatabaseSync | undefined;
}

function open() {
  mkdirSync(dataDir, { recursive: true });
  const d = new DatabaseSync(path.join(dataDir, "panel.db"));
  d.exec(`
    PRAGMA busy_timeout = 10000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      action TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Two-step sign-in columns, added in place so existing installs keep their users.
  const cols = (d.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("totp_secret")) {
    d.exec(`
      ALTER TABLE users ADD COLUMN totp_secret TEXT;
      ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0;
    `);
  }
  d.exec("PRAGMA foreign_keys = ON;");
  return d;
}

// Opened on first use, not on import, so `next build` workers do not fight over the file.
export const db: DatabaseSync = new Proxy({} as DatabaseSync, {
  get(_, prop) {
    const real = (globalThis.__opxDb ??= open());
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Role = "admin" | "editor" | "viewer";
export type UserRow = { id: number; username: string; role: Role; created_at: string; totp_enabled: number };

export function audit(actor: string | null, action: string, detail = "") {
  db.prepare("INSERT INTO audit (actor, action, detail) VALUES (?, ?, ?)").run(actor, action, detail);
}
