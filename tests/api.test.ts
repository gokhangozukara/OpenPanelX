import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  handleCreateTableRow,
  handleDeleteTableRow,
  handleGetPlugin,
  handleGetTable,
  handleHealth,
  handleListPlugins,
  handleUpdateTableRow,
} from "../src/lib/api-handlers";
import { db, resetDbForTests, type Role, type UserRow } from "../src/lib/db";
import { getPlugin, MAX_ROWS, saveRows } from "../src/lib/plugins";

let tempDir = "";

const makeUser = (role: Role, username = `user-${role}`): UserRow => ({
  id: role === "admin" ? 1 : role === "editor" ? 2 : 3,
  username,
  role,
  created_at: "2026-11-26 10:00:00",
  totp_enabled: 0,
  session_version: 1,
});

const jsonRequest = (method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>) =>
  new Request(url, {
    method,
    headers: {
      host: "localhost:3100",
      origin: "http://localhost:3100",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

before(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "openpanelx-api-test-"));
  process.env.OPENPANELX_DATA = tempDir;
});

after(() => {
  resetDbForTests();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("health and plugin read endpoints", () => {
  it("returns public health status with no-store header", async () => {
    const res = handleHealth();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { ok: boolean; name: string; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.name, "OpenPanelX");
    assert.equal(body.version, "0.4.4");
  });

  it("enforces authentication and omits filesystem dir on plugin list/detail", async () => {
    assert.equal(handleListPlugins(null).status, 401);
    assert.equal(handleGetPlugin(null, "notes", "en").status, 401);
    assert.equal(handleGetTable(null, "notes", "0").status, 401);

    const viewer = makeUser("viewer");
    const listRes = handleListPlugins(viewer);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { plugins: Array<Record<string, unknown>> };
    assert.ok(listData.plugins.some((p) => p.id === "notes"));
    assert.ok(listData.plugins.every((p) => !("dir" in p)));

    assert.equal(handleGetPlugin(viewer, "missing-plugin", "en").status, 404);
    const detailRes = handleGetPlugin(viewer, "notes", "en");
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as { plugin: Record<string, unknown> };
    assert.equal("dir" in detail.plugin, false);

    assert.equal(handleGetTable(viewer, "system", "0").status, 404);
    assert.equal(handleGetTable(viewer, "notes", "99").status, 404);
    assert.equal(handleGetTable(viewer, "notes", "0").status, 200);
  });
});

describe("table mutation endpoints", () => {
  it("enforces auth, viewer role denial, CSRF protection, and validation", async () => {
    const url = "http://localhost:3100/api/plugins/notes/tables/0";
    const viewer = makeUser("viewer");
    const editor = makeUser("editor");

    assert.equal((await handleCreateTableRow(jsonRequest("POST", url, { title: "x" }), null, "notes", "0")).status, 401);
    assert.equal(
      (await handleCreateTableRow(jsonRequest("POST", url, { title: "x" }), viewer, "notes", "0")).status,
      403,
    );
    assert.equal(
      (
        await handleCreateTableRow(
          jsonRequest("POST", url, { title: "x" }, { origin: "https://evil.example" }),
          editor,
          "notes",
          "0",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await handleCreateTableRow(
          jsonRequest("POST", url, { title: "x" }, { "sec-fetch-site": "cross-site" }),
          editor,
          "notes",
          "0",
        )
      ).status,
      403,
    );

    assert.equal(
      (await handleCreateTableRow(jsonRequest("POST", url, { title: "x" }), editor, "system", "0")).status,
      404,
    );
    assert.equal(
      (await handleCreateTableRow(jsonRequest("POST", url, "{bad-json"), editor, "notes", "0")).status,
      400,
    );
    assert.equal(
      (await handleCreateTableRow(jsonRequest("POST", url, { title: "   ", owner: "" }), editor, "notes", "0")).status,
      400,
    );
  });

  it("supports create, update, delete, missing-row 404s, and audit entries", async () => {
    const url = "http://localhost:3100/api/plugins/notes/tables/0";
    const editor = makeUser("editor", "editor-api");

    const createRes = await handleCreateTableRow(
      jsonRequest("POST", url, { title: "API row", owner: "editor-api", status: "Todo" }),
      editor,
      "notes",
      "0",
    );
    assert.equal(createRes.status, 201);
    const created = ((await createRes.json()) as { row: { _id: string; status: string } }).row;
    assert.ok(created._id);

    assert.equal(
      (await handleUpdateTableRow(jsonRequest("PATCH", url, { title: "No id" }), editor, "notes", "0")).status,
      400,
    );
    assert.equal(
      (
        await handleUpdateTableRow(
          jsonRequest("PATCH", url, { id: "does-not-exist", title: "X" }),
          editor,
          "notes",
          "0",
        )
      ).status,
      404,
    );

    const updateRes = await handleUpdateTableRow(
      jsonRequest("PATCH", url, { id: created._id, title: "API row", owner: "editor-api", status: "Done" }),
      editor,
      "notes",
      "0",
    );
    assert.equal(updateRes.status, 200);
    const updated = ((await updateRes.json()) as { row: { status: string } }).row;
    assert.equal(updated.status, "Done");

    assert.equal((await handleDeleteTableRow(jsonRequest("DELETE", url), editor, "notes", "0")).status, 400);
    assert.equal(
      (await handleDeleteTableRow(jsonRequest("DELETE", `${url}?id=missing-id`), editor, "notes", "0")).status,
      404,
    );

    const delRes = await handleDeleteTableRow(
      jsonRequest("DELETE", `${url}?id=${encodeURIComponent(created._id)}`),
      editor,
      "notes",
      "0",
    );
    assert.equal(delRes.status, 200);

    const actions = (
      db.prepare("SELECT action FROM audit WHERE actor = ? ORDER BY id").all("editor-api") as { action: string }[]
    ).map((r) => r.action);
    assert.deepEqual(actions, ["row.add", "row.update", "row.delete"]);
  });

  it("returns 409 when table row limit is reached", async () => {
    const notes = getPlugin("notes");
    assert.ok(notes);
    const fullRows = Array.from({ length: MAX_ROWS }, (_, idx) => ({
      _id: `r-${idx}`,
      title: `Row ${idx}`,
      owner: "qa",
      status: "Done",
    }));
    saveRows(notes, 0, fullRows);

    const editor = makeUser("editor");
    const res = await handleCreateTableRow(
      jsonRequest("POST", "http://localhost:3100/api/plugins/notes/tables/0", { title: "Overflow" }),
      editor,
      "notes",
      "0",
    );
    assert.equal(res.status, 409);
  });
});
