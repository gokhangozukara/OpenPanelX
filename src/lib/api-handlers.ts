import { randomUUID } from "node:crypto";
import { audit, type Role, type UserRow } from "./db";
import type { Lang } from "./i18n";
import {
  editableTable,
  getPlugin,
  listPlugins,
  MAX_CELL,
  MAX_ROWS,
  mutateTableRows,
  systemValue,
  tableRows,
  type Row,
} from "./plugins";
import { hasRole, isSameOrigin } from "./security";

function parseIndex(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function resolveTable(pluginId: string, rawIndex: string, minEdit: boolean, roleCheck: (min: Role) => boolean) {
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

export function handleHealth(): Response {
  return Response.json(
    {
      ok: true,
      name: "OpenPanelX",
      version: "0.4.3",
      uptime: Math.floor(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function handleListPlugins(user: UserRow | null): Response {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const plugins = listPlugins()
    .filter((p) => hasRole(user, p.minRole))
    .map(({ id, name, description, icon, minRole }) => ({ id, name, description, icon, minRole }));
  return Response.json({ plugins }, { headers: { "Cache-Control": "no-store" } });
}

export function handleGetPlugin(user: UserRow | null, id: string, lang: Lang): Response {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const plugin = getPlugin(id);
  if (!plugin || !hasRole(user, plugin.minRole)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const sections = plugin.sections.map((section, index) => {
    if (section.type === "stats") {
      return {
        type: "stats" as const,
        items: section.items.map((item) => ({
          label: item.label,
          value: item.source ? systemValue(item.source, lang) : item.value ?? null,
        })),
      };
    }
    if (section.type === "table") {
      return {
        type: "table" as const,
        index,
        title: section.title,
        columns: section.columns,
        editable: Boolean(section.editable),
        rows: tableRows(plugin, section, index),
      };
    }
    return section;
  });

  return Response.json(
    {
      plugin: {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        minRole: plugin.minRole,
        sections,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function handleGetTable(user: UserRow | null, id: string, rawIndex: string): Response {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const resolved = resolveTable(id, rawIndex, false, (min) => hasRole(user, min));
  if (!resolved) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(
    {
      columns: resolved.section.columns,
      editable: Boolean(resolved.section.editable),
      rows: tableRows(resolved.plugin, resolved.section, resolved.index),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function handleCreateTableRow(
  request: Request,
  user: UserRow | null,
  id: string,
  rawIndex: string,
): Promise<Response> {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const resolved = resolveTable(id, rawIndex, true, (min) => hasRole(user, min));
  if (!resolved) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const values = extractValues(body as Record<string, unknown>, resolved.section.columns);
  if (resolved.section.columns.every((c) => values[c.key] === "")) {
    return Response.json({ error: "Fill in at least one field" }, { status: 400 });
  }

  const outcome = mutateTableRows<
    { ok: true; row: Row } | { ok: false; status: 409; error: string }
  >(resolved.plugin, resolved.section, resolved.index, (rows) => {
    if (rows.length >= MAX_ROWS) {
      return { result: { ok: false, status: 409, error: "Table row limit reached" } };
    }
    const row: Row = { _id: randomUUID(), ...values };
    return { rows: [...rows, row], result: { ok: true, row } };
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  audit(user.username, "row.add", resolved.plugin.id);
  return Response.json({ row: outcome.row }, { status: 201 });
}

export async function handleUpdateTableRow(
  request: Request,
  user: UserRow | null,
  id: string,
  rawIndex: string,
): Promise<Response> {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const resolved = resolveTable(id, rawIndex, true, (min) => hasRole(user, min));
  if (!resolved) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const rowId = String(record.id ?? "").trim();
  if (!rowId) return Response.json({ error: "Row id is required" }, { status: 400 });

  const values = extractValues(record, resolved.section.columns);
  if (resolved.section.columns.every((c) => values[c.key] === "")) {
    return Response.json({ error: "Fill in at least one field" }, { status: 400 });
  }

  const outcome = mutateTableRows<
    { ok: true; row: Row } | { ok: false; status: 404; error: string }
  >(resolved.plugin, resolved.section, resolved.index, (rows) => {
    const pos = rows.findIndex((r) => String(r._id ?? "") === rowId);
    if (pos < 0) return { result: { ok: false, status: 404, error: "Row not found" } };
    const row: Row = { _id: rowId, ...values };
    const nextRows = [...rows];
    nextRows[pos] = row;
    return { rows: nextRows, result: { ok: true, row } };
  });

  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  audit(user.username, "row.update", resolved.plugin.id);
  return Response.json({ row: outcome.row });
}

export async function handleDeleteTableRow(
  request: Request,
  user: UserRow | null,
  id: string,
  rawIndex: string,
): Promise<Response> {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!hasRole(user, "editor")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const resolved = resolveTable(id, rawIndex, true, (min) => hasRole(user, min));
  if (!resolved) return Response.json({ error: "Not found" }, { status: 404 });

  let rowId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!rowId) {
    try {
      const body = (await request.json()) as { id?: unknown };
      rowId = String(body?.id ?? "").trim();
    } catch {
      rowId = "";
    }
  }
  if (!rowId) return Response.json({ error: "Row id is required" }, { status: 400 });

  const deleted = mutateTableRows<boolean>(resolved.plugin, resolved.section, resolved.index, (rows) => {
    const filtered = rows.filter((r) => String(r._id ?? "") !== rowId);
    if (filtered.length === rows.length) return { result: false };
    return { rows: filtered, result: true };
  });

  if (!deleted) return Response.json({ error: "Row not found" }, { status: 404 });
  audit(user.username, "row.delete", resolved.plugin.id);
  return Response.json({ ok: true });
}
