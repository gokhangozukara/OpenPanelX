import { addRow, deleteRow } from "@/app/actions";
import type { Lang, T } from "@/lib/i18n";
import { pick } from "@/lib/i18n";
import { systemValue, tableRows, type Plugin, type Section } from "@/lib/plugins";
import { ActionForm } from "./forms";

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
                    {it.source ? systemValue(it.source) : String(it.value ?? "–")}
                  </p>
                </div>
              ))}
            </div>
          );
        }
        if (s.type === "table") {
          const rows = tableRows(plugin, s, i);
          const editing = canEdit && s.editable;
          return (
            <section key={i} className="card overflow-hidden">
              {s.title && <h2 className="border-b border-line px-5 py-3.5 text-sm font-medium">{pick(s.title, lang)}</h2>}
              {rows.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">{t("empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs text-muted">
                        {s.columns.map((c) => (
                          <th key={c.key} className="px-5 py-2.5 font-medium whitespace-nowrap">
                            {pick(c.label, lang)}
                          </th>
                        ))}
                        {editing && <th className="px-5 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, r) => (
                        <tr key={String(row._id ?? r)} className="border-b border-line last:border-0">
                          {s.columns.map((c) => (
                            <td key={c.key} className="px-5 py-3">
                              {String(row[c.key] ?? "")}
                            </td>
                          ))}
                          {editing && (
                            <td className="px-5 py-3 text-right">
                              <form action={deleteRow.bind(null, plugin.id, i)}>
                                <input type="hidden" name="rowId" value={String(row._id)} />
                                <button className="cursor-pointer text-sm text-danger hover:underline">{t("delete")}</button>
                              </form>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {editing && (
                <div className="border-t border-line bg-soft/40 p-5">
                  <ActionForm
                    action={addRow.bind(null, plugin.id, i)}
                    submit={t("addRow")}
                    resetOnOk
                    className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] sm:items-end"
                  >
                    {s.columns.map((c) => (
                      <div key={c.key}>
                        <label className="label" htmlFor={`${i}-${c.key}`}>
                          {pick(c.label, lang)}
                        </label>
                        <input className="input" id={`${i}-${c.key}`} name={c.key} maxLength={500} autoComplete="off" />
                      </div>
                    ))}
                  </ActionForm>
                </div>
              )}
            </section>
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
