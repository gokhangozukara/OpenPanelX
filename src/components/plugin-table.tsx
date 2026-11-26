"use client";

import { Download, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { FormState } from "@/app/actions";
import { ActionForm } from "./forms";

export type TableColumn = { key: string; label: string };
export type TableRow = { id: string; cells: Record<string, string> };
export type TableLabels = {
  empty: string;
  noMatches: string;
  search: string;
  exportCsv: string;
  addRow: string;
  edit: string;
  save: string;
  cancel: string;
  delete: string;
};

function escapeCsvCell(raw: string): string {
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function EditRow({
  row,
  columns,
  labels,
  updateAction,
  onCancel,
}: {
  row: TableRow;
  columns: TableColumn[];
  labels: TableLabels;
  updateAction: (s: FormState, f: FormData) => Promise<FormState>;
  onCancel: () => void;
}) {
  const [state, run, pending] = useActionState(updateAction, undefined);

  useEffect(() => {
    if (state?.ok) onCancel();
  }, [state, onCancel]);

  return (
    <td colSpan={columns.length + 1} className="bg-soft/40 px-5 py-3">
      <form action={run} className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] sm:items-end">
        <input type="hidden" name="rowId" value={row.id} />
        {columns.map((c) => (
          <div key={c.key}>
            <label className="label" htmlFor={`edit-${row.id}-${c.key}`}>
              {c.label}
            </label>
            <input
              id={`edit-${row.id}-${c.key}`}
              name={c.key}
              defaultValue={row.cells[c.key] ?? ""}
              maxLength={500}
              autoComplete="off"
              className="input !h-9"
            />
          </div>
        ))}
        <div className="flex items-center gap-2 sm:justify-end">
          <button type="submit" disabled={pending} className="btn !h-9 !px-3 !text-xs">
            {labels.save}
          </button>
          <button type="button" onClick={onCancel} className="btn-ghost !h-9 !px-3 !text-xs">
            {labels.cancel}
          </button>
        </div>
        {state?.error && (
          <p role="alert" className="text-xs text-danger sm:col-span-full">
            {state.error}
          </p>
        )}
      </form>
    </td>
  );
}

export function PluginTable({
  pluginId,
  sectionIndex,
  title,
  columns,
  rows,
  editable,
  labels,
  addAction,
  updateAction,
  deleteAction,
}: {
  pluginId: string;
  sectionIndex: number;
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
  editable: boolean;
  labels: TableLabels;
  addAction: (s: FormState, f: FormData) => Promise<FormState>;
  updateAction: (s: FormState, f: FormData) => Promise<FormState>;
  deleteAction: (f: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => (row.cells[c.key] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, query]);

  const downloadCsv = () => {
    const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
    const body = filtered.map((row) =>
      columns.map((c) => escapeCsvCell(row.cells[c.key] ?? "")).join(","),
    );
    const csv = "\uFEFF" + [header, ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pluginId}-table-${sectionIndex + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card overflow-hidden">
      {(title || rows.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title ? <h2 className="text-sm font-medium">{title}</h2> : <span />}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={labels.search}
                  aria-label={labels.search}
                  className="h-8 w-44 rounded-lg border border-line bg-surface pr-2.5 pl-8 text-xs text-fg outline-none transition placeholder:text-muted focus:border-fg sm:w-52"
                />
              </div>
              <button type="button" onClick={downloadCsv} className="btn-ghost !h-8 !px-2.5 !text-xs">
                <Download className="size-3.5" aria-hidden />
                {labels.exportCsv}
              </button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{labels.empty}</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{labels.noMatches}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                {columns.map((c) => (
                  <th key={c.key} className="px-5 py-2.5 font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                {editable && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  {editable && editingId === row.id ? (
                    <EditRow
                      row={row}
                      columns={columns}
                      labels={labels}
                      updateAction={updateAction}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      {columns.map((c) => (
                        <td key={c.key} className="px-5 py-3">
                          {row.cells[c.key] ?? ""}
                        </td>
                      ))}
                      {editable && (
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-4">
                            <button
                              type="button"
                              onClick={() => setEditingId(row.id)}
                              className="cursor-pointer text-sm text-muted hover:text-fg hover:underline"
                            >
                              {labels.edit}
                            </button>
                            <form action={deleteAction} className="inline">
                              <input type="hidden" name="rowId" value={row.id} />
                              <button className="cursor-pointer text-sm text-danger hover:underline">{labels.delete}</button>
                            </form>
                          </div>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <div className="border-t border-line bg-soft/40 p-5">
          <ActionForm
            action={addAction}
            submit={labels.addRow}
            resetOnOk
            className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] sm:items-end"
          >
            {columns.map((c) => (
              <div key={c.key}>
                <label className="label" htmlFor={`${sectionIndex}-${c.key}`}>
                  {c.label}
                </label>
                <input className="input" id={`${sectionIndex}-${c.key}`} name={c.key} maxLength={500} autoComplete="off" />
              </div>
            ))}
          </ActionForm>
        </div>
      )}
    </section>
  );
}
