import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appSecret } from "./auth";

/** Standard time-based one-time passwords (RFC 6238): 6 digits, 30 seconds, SHA-1. Works with any authenticator app. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => toBase32(randomBytes(20));

function code(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Checks a code, allowing one step of clock drift either way. Returns the matched time step,
 * or null. A step at or below `lastStep` is refused so a code can never be used twice.
 */
export function checkTotp(secret: string, token: string, lastStep: number): number | null {
  const digits = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue;
    const a = Buffer.from(code(secret, step));
    const b = Buffer.from(digits);
    if (timingSafeEqual(a, b)) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent("OpenPanelX")}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent("OpenPanelX")}&algorithm=SHA1&digits=6&period=30`;

// The authenticator secret is stored encrypted, so a copied database file alone cannot be used to
// generate codes. The key comes from the panel's signing secret.
const key = () => createHash("sha256").update("totp|" + appSecret()).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Recovery codes: shown once, stored only as hashes.
export const hashRecovery = (c: string) => createHash("sha256").update(c.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");

export function newRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = toBase32(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
