import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getUser, hasRole } from "@/lib/auth";
import { audit } from "@/lib/db";
import { editableTable, getPlugin, MAX_CELL, MAX_ROWS, saveRows, tableRows, type Row } from "@/lib/plugins";
import { isSameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; index: string }> };

function parseIndex(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function resolveTable(pluginId: string, rawIndex: string, minEdit: boolean, roleCheck: (min: "viewer" | "editor" | "admin") => boolean) {
  const plugin = getPlugin(pluginId);
  const index = parseIndex(rawIndex);
  if (!plugin || index === null || !roleCheck(plugin.minRole)) return null;
  const section = plugin.sections[index];
  if (!section || section.type !== "table") return null;
  if (minEdit && !editableTable(plugin, index)) return null;
  return { plugin, index, section };
}

function extractValues(body: Record<string, unknown>, columns: { key: string }[]): Row {
  const source =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : body;
  const out: Row = {};
  for (const col of columns) {
    out[col.key] = String(source[col.key] ?? "").trim().slice(0, MAX_CELL);
  }
  return out;
}

export async function GET(_: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, index } = await params;
  const resolved = resolveTable(id, index, false, (min) => hasRole(user, min));
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    {
      columns: resolved.section.columns,
      editable: Boolean(resolved.section.editable),
      rows: tableRows(resolved.plugin, resolved.section, resolved.index),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, index } = await params;
  const resolved = resolveTable(id, index, true, (min) => hasRole(user, min));
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const values = extractValues(body, resolved.section.columns);
  if (resolved.section.columns.every((c) => values[c.key] === "")) {
    return NextResponse.json({ error: "Fill in at least one field" }, { status: 400 });
  }

  const rows = tableRows(resolved.plugin, resolved.section, resolved.index);
  if (rows.length >= MAX_ROWS) {
    return NextResponse.json({ error: "Table row limit reached" }, { status: 409 });
  }

  const row: Row = { _id: randomUUID(), ...values };
  saveRows(resolved.plugin, resolved.index, [...rows, row]);
  audit(user.username, "row.add", resolved.plugin.id);

  return NextResponse.json({ row }, { status: 201 });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, index } = await params;
  const resolved = resolveTable(id, index, true, (min) => hasRole(user, min));
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rowId = String(body.id ?? "").trim();
  if (!rowId) return NextResponse.json({ error: "Row id is required" }, { status: 400 });

  const values = extractValues(body, resolved.section.columns);
  if (resolved.section.columns.every((c) => values[c.key] === "")) {
    return NextResponse.json({ error: "Fill in at least one field" }, { status: 400 });
  }

  const rows = tableRows(resolved.plugin, resolved.section, resolved.index);
  const pos = rows.findIndex((r) => String(r._id ?? "") === rowId);
  if (pos < 0) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  const row: Row = { _id: rowId, ...values };
  const nextRows = [...rows];
  nextRows[pos] = row;
  saveRows(resolved.plugin, resolved.index, nextRows);
  audit(user.username, "row.update", resolved.plugin.id);

  return NextResponse.json({ row });
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, index } = await params;
  const resolved = resolveTable(id, index, true, (min) => hasRole(user, min));
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let rowId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!rowId) {
    try {
      const body = (await request.json()) as { id?: unknown };
      rowId = String(body.id ?? "").trim();
    } catch {
      rowId = "";
    }
  }
  if (!rowId) return NextResponse.json({ error: "Row id is required" }, { status: 400 });

  const rows = tableRows(resolved.plugin, resolved.section, resolved.index);
  const filtered = rows.filter((r) => String(r._id ?? "") !== rowId);
  if (filtered.length === rows.length) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  saveRows(resolved.plugin, resolved.index, filtered);
  audit(user.username, "row.delete", resolved.plugin.id);

  return NextResponse.json({ ok: true });
}
