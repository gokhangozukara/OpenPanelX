import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetDbForTests } from "../src/lib/db";
import { getPlugin, listPlugins, saveRows, seedRows, tableRows } from "../src/lib/plugins";
import {
  clearFailures,
  hashPassword,
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
  it("packs, unpacks, and rejects tampered, expired, or unversioned tokens", () => {
    const token = packToken(42, 3, 60_000);
    assert.deepEqual(unpackToken(token), { userId: 42, version: 3 });

    const [body, sig] = token.split(".");
    assert.equal(unpackToken(`${body}.${sig.slice(0, -1)}X`), null);
    assert.equal(unpackToken(packToken(42, 3, -1000)), null);

    const legacyBody = Buffer.from(JSON.stringify({ u: 42, exp: Date.now() + 60_000 })).toString("base64url");
    assert.equal(unpackToken(`${legacyBody}.${sig}`), null);
  });
});

describe("persistent rate limits", () => {
  it("persists failed-attempt lockouts across database restarts", () => {
    const key = "127.0.0.1|alice";
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

  it("persists editable table changes in dataDir without touching plugin files", () => {
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
  });
});
