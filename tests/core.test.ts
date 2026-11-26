import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetDbForTests } from "../src/lib/db";
import { getPlugin, listPlugins, mutateTableRows, saveRows, seedRows, tableRows } from "../src/lib/plugins";
import {
  accountBackoffMs,
  clearFailures,
  clientIpFromHeaders,
  hashPassword,
  isSameOrigin,
  noteFailure,
  packToken,
  tooManyAttempts,
  unpackToken,
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
  it("separates session and pending token types and rejects tampered or expired tokens", () => {
    const session = packToken("session", 42, 3, 60_000);
    const pending = packToken("pending", 42, 0, 60_000);

    assert.deepEqual(unpackToken(session, "session"), { userId: 42, version: 3 });
    assert.deepEqual(unpackToken(pending, "pending"), { userId: 42, version: 0 });
    assert.equal(unpackToken(pending, "session"), null);
    assert.equal(unpackToken(session, "pending"), null);

    const [body, sig] = session.split(".");
    assert.equal(unpackToken(`${body}.${sig.slice(0, -1)}X`, "session"), null);
    assert.equal(unpackToken(packToken("session", 42, 3, -1000), "session"), null);

    const untypedBody = Buffer.from(JSON.stringify({ u: 42, v: 3, exp: Date.now() + 60_000 })).toString("base64url");
    assert.equal(unpackToken(`${untypedBody}.${sig}`, "session"), null);
  });
});

describe("rate limits and proxy headers", () => {
  it("persists failed-attempt lockouts across database restarts", () => {
    const key = "user|alice";
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

  it("isolates IP-user lockouts and applies bounded progressive backoff per account", () => {
    const attackerKey = "ipuser|203.0.113.5|admin";
    const realAdminKey = "ipuser|198.51.100.10|admin";
    const accountKey = "user|admin";

    for (let i = 0; i < 5; i++) noteFailure(attackerKey);
    assert.equal(tooManyAttempts(attackerKey, 5), true);
    assert.equal(tooManyAttempts(realAdminKey, 5), false);

    assert.equal(accountBackoffMs(accountKey), 0);
    noteFailure(accountKey);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 0);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 250);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 500);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 1000);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 2000);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 3000);
    noteFailure(accountKey);
    assert.equal(accountBackoffMs(accountKey), 3000);

    clearFailures(accountKey);
    assert.equal(accountBackoffMs(accountKey), 0);
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
