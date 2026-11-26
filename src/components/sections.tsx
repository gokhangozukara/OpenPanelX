import { addRow, deleteRow, updateRow } from "@/app/actions";
import type { Lang, T } from "@/lib/i18n";
import { pick } from "@/lib/i18n";
import { systemValue, tableRows, type Cell, type Plugin, type Section } from "@/lib/plugins";
import { PluginTable } from "./plugin-table";

function cellText(value: Cell | undefined, lang: Lang): string {
  if (value && typeof value === "object") return pick(value, lang);
  return String(value ?? "");
}

export function Sections({ plugin, lang, t, canEdit }: { plugin: Plugin; lang: Lang; t: T; canEdit: boolean }) {
  return (
    <div className="grid gap-6">
      {plugin.sections.map((s: Section, i) => {
        if (s.type === "stats") {
          return (
            <div key={i} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {s.items.map((it, j) => (
                <div key={j} className="card p-5">
                  <p className="text-xs text-muted">{pick(it.label, lang)}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                    {it.source ? systemValue(it.source, lang) : String(it.value ?? "–")}
                  </p>
                </div>
              ))}
            </div>
          );
        }
        if (s.type === "table") {
          const rows = tableRows(plugin, s, i).map((row, r) => ({
            id: String(row._id ?? r),
            cells: Object.fromEntries(s.columns.map((c) => [c.key, cellText(row[c.key], lang)])),
          }));
          const columns = s.columns.map((c) => ({ key: c.key, label: pick(c.label, lang) }));
          return (
            <PluginTable
              key={i}
              pluginId={plugin.id}
              sectionIndex={i}
              title={s.title ? pick(s.title, lang) : undefined}
              columns={columns}
              rows={rows}
              editable={Boolean(canEdit && s.editable)}
              labels={{
                empty: t("empty"),
                noMatches: t("noMatches"),
                search: t("search"),
                exportCsv: t("exportCsv"),
                addRow: t("addRow"),
                edit: t("edit"),
                save: t("save"),
                cancel: t("cancel"),
                delete: t("delete"),
              }}
              addAction={addRow.bind(null, plugin.id, i)}
              updateAction={updateRow.bind(null, plugin.id, i)}
              deleteAction={deleteRow.bind(null, plugin.id, i)}
            />
          );
        }
        return (
          <section key={i} className="card p-5">
            {s.title && <h2 className="mb-2 text-sm font-medium">{pick(s.title, lang)}</h2>}
            <p className="whitespace-pre-line text-sm text-muted">{pick(s.body, lang)}</p>
          </section>
        );
      })}
    </div>
  );
}
