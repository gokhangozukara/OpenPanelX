import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetDbForTests } from "../src/lib/db";
import { getPlugin, listPlugins, mutateTableRows, saveRows, seedRows, tableRows } from "../src/lib/plugins";
import {
  clearFailures,
  clientIpFromHeaders,
  DEFAULT_ACCOUNT_MAX,
  hashPassword,
  isSameOrigin,
  loginStepMs,
  noteFailure,
  packKnownUser,
  packToken,
  reserveLoginSlot,
  tooManyAttempts,
  unpackToken,
  verifyKnownUser,
  verifyPassword,
} from "../src/lib/security";
import { checkTotp, generateTotp, hashRecovery, newRecoveryCodes, newTotpSecret, open, seal } from "../src/lib/totp";

let tempDir = "";

before(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "openpanelx-test-"));
  process.env.OPENPANELX_DATA = tempDir;
});

after(() => {
  resetDbForTests();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("passwords", () => {
  it("hashes and verifies scrypt passwords", () => {
    const hash = hashPassword("correct-horse-battery");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(verifyPassword("correct-horse-battery", hash), true);
    assert.equal(verifyPassword("wrong-password", hash), false);
    assert.equal(verifyPassword("anything", "bad-format"), false);
  });
});

describe("signed tokens", () => {
  it("separates session, pending, and known-browser token types and rejects tampered or expired tokens", () => {
    const session = packToken("session", 42, 3, 60_000);
    const pending = packToken("pending", 42, 0, 60_000);
    const known = packKnownUser("Admin", 60_000);

    assert.deepEqual(unpackToken(session, "session"), { userId: 42, version: 3 });
    assert.deepEqual(unpackToken(pending, "pending"), { userId: 42, version: 0 });
    assert.equal(unpackToken(pending, "session"), null);
    assert.equal(unpackToken(session, "pending"), null);
    assert.equal(unpackToken(known, "session"), null);
    assert.equal(unpackToken(known, "pending"), null);

    assert.equal(verifyKnownUser(known, "admin"), true);
    assert.equal(verifyKnownUser(known, "other"), false);
    assert.equal(verifyKnownUser(packKnownUser("admin", -1000), "admin"), false);
    assert.equal(verifyKnownUser(`${known}x`, "admin"), false);

    const [body, sig] = session.split(".");
    assert.equal(unpackToken(`${body}.${sig.slice(0, -1)}X`, "session"), null);
    assert.equal(unpackToken(packToken("session", 42, 3, -1000), "session"), null);

    const untypedBody = Buffer.from(JSON.stringify({ u: 42, v: 3, exp: Date.now() + 60_000 })).toString("base64url");
    assert.equal(unpackToken(`${untypedBody}.${sig}`, "session"), null);
  });
});

describe("rate limits, serialized pacing, and proxy headers", () => {
  it("persists failed-attempt lockouts across database restarts", () => {
    const key = "ipuser|203.0.113.5|alice";
    assert.equal(tooManyAttempts(key), false);
    for (let i = 0; i < 4; i++) noteFailure(key);
    assert.equal(tooManyAttempts(key), false);
    noteFailure(key);
    assert.equal(tooManyAttempts(key), true);

    resetDbForTests();
    assert.equal(tooManyAttempts(key), true);

    clearFailures(key);
    assert.equal(tooManyAttempts(key), false);
  });

  it("serializes parallel bursts, rejects queue overflow, and enforces default ceiling without locking known browsers", () => {
    const key = "user|admin";
    const t0 = Date.now() + 10_000;

    // 1. Parallel burst at identical timestamp t0: slots advance sequentially by 200ms up to 4000ms, then reject immediately.
    const waits: number[] = [];
    let rejected = 0;
    for (let i = 0; i < 30; i++) {
      const slot = reserveLoginSlot(key, { hardMax: DEFAULT_ACCOUNT_MAX, maxQueueWaitMs: 4000, now: t0 });
      if (slot.allowed) waits.push(slot.waitMs);
      else rejected++;
    }
    assert.equal(waits[0], 0);
    assert.equal(waits[1], 200);
    assert.equal(waits.at(-1), 4000);
    assert.equal(waits.length, 21);
    assert.equal(rejected, 9);

    // 2. High failure count scales spacing up to 3000ms and persists across DB restart.
    clearFailures(key);
    assert.equal(loginStepMs(0), 200);
    assert.equal(loginStepMs(3), 250);
    assert.equal(loginStepMs(5), 1000);
    assert.equal(loginStepMs(7), 3000);
    assert.equal(loginStepMs(20), 3000);

    const t1 = t0 + 10_000;
    for (let i = 0; i < 7; i++) noteFailure(key, t1);
    resetDbForTests();

    // Immediately after 7 failures, next_at is t1 + 3000: first attempt waits 3000ms, second parallel attempt exceeds 4000ms and is rejected.
    const first = reserveLoginSlot(key, { hardMax: DEFAULT_ACCOUNT_MAX, maxQueueWaitMs: 4000, now: t1 });
    assert.equal(first.allowed, true);
    assert.equal(first.waitMs, 3000);
    const secondParallel = reserveLoginSlot(key, { hardMax: DEFAULT_ACCOUNT_MAX, maxQueueWaitMs: 4000, now: t1 });
    assert.equal(secondParallel.allowed, false);

    // 3. After DEFAULT_ACCOUNT_MAX (20) failures, unknown non-proxy clients hit the hard ceiling,
    //    while known browsers / clean proxy IPs (hardMax undefined) are never hard-locked out.
    for (let i = 7; i < DEFAULT_ACCOUNT_MAX; i++) noteFailure(key, t1);
    const blockedAttacker = reserveLoginSlot(key, { hardMax: DEFAULT_ACCOUNT_MAX, maxQueueWaitMs: 4000, now: t1 + 10_000 });
    assert.equal(blockedAttacker.allowed, false);

    const allowedAdmin = reserveLoginSlot(key, { hardMax: undefined, maxQueueWaitMs: 4000, now: t1 + 10_000 });
    assert.equal(allowedAdmin.allowed, true);
    assert.equal(allowedAdmin.waitMs, 0);

    clearFailures(key);
  });

  it("isolates IP-user lockouts across different client IPs", () => {
    const attackerKey = "ipuser|203.0.113.5|admin";
    const realAdminKey = "ipuser|198.51.100.10|admin";

    for (let i = 0; i < 5; i++) noteFailure(attackerKey);
    assert.equal(tooManyAttempts(attackerKey, 5), true);
    assert.equal(tooManyAttempts(realAdminKey, 5), false);
    clearFailures(attackerKey);
  });

  it("ignores forwarded IP headers unless OPENPANELX_TRUST_PROXY is enabled", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1", "x-real-ip": "203.0.113.9" });
    assert.equal(clientIpFromHeaders(headers, false), null);
    assert.equal(clientIpFromHeaders(headers, true), "203.0.113.5");
    assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" }), true), "198.51.100.2");
  });

  it("enforces same-origin rules for cookie-authenticated mutations", () => {
    const same = new Request("http://localhost:3100/api/plugins/notes/tables/0", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "http://localhost:3100", "content-type": "application/json" },
    });
    assert.equal(isSameOrigin(same), true);

    const evilOrigin = new Request("http://localhost:3100/api/plugins/notes/tables/0", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "https://evil.example", "content-type": "application/json" },
    });
    assert.equal(isSameOrigin(evilOrigin), false);

    const crossSiteFetch = new Request("http://localhost:3100/api/plugins/notes/tables/0", {
      method: "POST",
      headers: { host: "localhost:3100", "sec-fetch-site": "cross-site", "content-type": "application/json" },
    });
    assert.equal(isSameOrigin(crossSiteFetch), false);

    const noHeadersForm = new Request("http://localhost:3100/api/plugins/notes/tables/0", {
      method: "POST",
      headers: { host: "localhost:3100", "content-type": "text/plain" },
    });
    assert.equal(isSameOrigin(noHeadersForm), false);
  });
});

describe("TOTP and recovery codes", () => {
  it("accepts a valid TOTP once and blocks replay on the same step", () => {
    const secret = newTotpSecret();
    const now = Date.now();
    const code = generateTotp(secret, now);

    const step = checkTotp(secret, code, 0);
    assert.ok(typeof step === "number" && step > 0);
    assert.equal(checkTotp(secret, code, step), null);
    assert.equal(checkTotp(secret, "000000", 0) === step, false);
  });

  it("seals and opens secrets and generates hashed recovery codes", () => {
    const secret = newTotpSecret();
    const sealed = seal(secret);
    assert.equal(open(sealed), secret);
    assert.equal(open(`${sealed}tampered`), null);

    const codes = newRecoveryCodes(8);
    assert.equal(codes.length, 8);
    assert.equal(hashRecovery(codes[0]), hashRecovery(codes[0].toUpperCase().replace("-", "")));
  });
});

describe("plugins", () => {
  it("lists built-in plugins and rejects path traversal in seed files", () => {
    const plugins = listPlugins();
    assert.ok(plugins.some((p) => p.id === "notes"));
    assert.ok(plugins.some((p) => p.id === "system"));

    const notes = getPlugin("notes");
    assert.ok(notes);
    assert.deepEqual(
      seedRows(notes, { type: "table", columns: [], file: "../package.json" }),
      [],
    );
  });

  it("persists atomic table mutations in dataDir without leaving tmp files or modifying plugin files", () => {
    const notes = getPlugin("notes");
    assert.ok(notes);
    const section = notes.sections[0];
    assert.equal(section.type, "table");
    if (section.type !== "table") return;

    const beforePluginFile = readFileSync(path.join(notes.dir, "data.json"), "utf8");
    const initial = tableRows(notes, section, 0);
    assert.ok(initial.length >= 1);

    const updated = [...initial, { _id: "test-row", title: "Test", owner: "qa", status: "Done" }];
    saveRows(notes, 0, updated);

    const reloaded = tableRows(notes, section, 0);
    assert.equal(reloaded.length, initial.length + 1);
    assert.equal(reloaded.at(-1)?.title, "Test");
    assert.equal(readFileSync(path.join(notes.dir, "data.json"), "utf8"), beforePluginFile);

    const nextCount = mutateTableRows(notes, section, 0, (rows) => {
      const next = [...rows, { _id: "atomic-row", title: "Atomic", owner: "qa", status: "Todo" }];
      return { rows: next, result: next.length };
    });
    assert.equal(nextCount, initial.length + 2);

    assert.throws(() => {
      mutateTableRows(notes, section, 0, () => {
        throw new Error("abort mutation");
      });
    }, /abort mutation/);
    assert.equal(tableRows(notes, section, 0).length, initial.length + 2);

    const files = readdirSync(path.join(tempDir, "plugins"));
    assert.equal(files.some((f) => f.endsWith(".tmp")), false);
  });
});
