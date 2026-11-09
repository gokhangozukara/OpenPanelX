import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Lang, Localized } from "./i18n";
import { dataDir, type Role } from "./db";

/** A cell is plain text, a number, or text per language: { "en": "", "tr": "", "de": "" }. */
export type Cell = string | number | Partial<Record<Lang, string>>;
export type Row = Record<string, Cell>;

/**
 * A plugin is a folder inside /plugins with a plugin.json. No build step, no code in the core:
 * the panel reads the folder on every request, so dropping a folder in is enough.
 */
export type Section =
  | { type: "stats"; items: { label: Localized; value?: string | number; source?: "@system.uptime" | "@system.memory" | "@system.cpus" | "@system.load" | "@system.host" }[] }
  | { type: "table"; title?: Localized; columns: { key: string; label: Localized }[]; file?: string; rows?: Row[]; editable?: boolean }
  | { type: "text"; title?: Localized; body: Localized };

export type Plugin = {
  id: string;
  name: Localized;
  description?: Localized;
  icon: string;
  minRole: Role;
  sections: Section[];
  dir: string;
};

const ROOT = path.join(process.cwd(), "plugins");
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function listPlugins(): Plugin[] {
  if (!existsSync(ROOT)) return [];
  const out: Plugin[] = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    const dir = path.join(ROOT, entry.name);
    try {
      const m = JSON.parse(readFileSync(path.join(dir, "plugin.json"), "utf8"));
      if (!m || typeof m !== "object" || !Array.isArray(m.sections)) continue;
      out.push({
        id: entry.name,
        name: m.name ?? entry.name,
        description: m.description,
        icon: typeof m.icon === "string" ? m.icon : "puzzle",
        minRole: m.minRole === "admin" || m.minRole === "editor" ? m.minRole : "viewer",
        sections: m.sections,
        dir,
      });
    } catch {
      // A broken plugin must never break the panel. It is simply skipped.
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const getPlugin = (id: string) => (ID.test(id) ? listPlugins().find((p) => p.id === id) : undefined);

type TableSection = Extract<Section, { type: "table" }>;

/** The starting rows of a table: inline rows, or a JSON file that must live inside the plugin folder. */
function seedRows(plugin: Plugin, s: TableSection): Row[] {
  if (s.rows) return s.rows;
  if (!s.file) return [];
  const file = path.resolve(plugin.dir, s.file);
  if (!file.startsWith(plugin.dir + path.sep)) return []; // no escaping the plugin folder
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Edits never touch the plugin folder. They are stored in the data folder, so a plugin
// can be updated or replaced without losing what people entered.
const storeFile = (plugin: Plugin, index: number) => path.join(dataDir, "plugins", `${plugin.id}-${index}.json`);

export function tableRows(plugin: Plugin, s: TableSection, index: number): Row[] {
  if (!s.editable) return seedRows(plugin, s);
  try {
    const saved = JSON.parse(readFileSync(storeFile(plugin, index), "utf8"));
    if (Array.isArray(saved)) return saved;
  } catch {
    // nothing saved yet: fall through to the starting rows
  }
  return seedRows(plugin, s).map((r, i) => ({ ...r, _id: `seed-${i}` }));
}

export function saveRows(plugin: Plugin, index: number, rows: Row[]) {
  mkdirSync(path.join(dataDir, "plugins"), { recursive: true });
  writeFileSync(storeFile(plugin, index), JSON.stringify(rows, null, 2));
}

// Short unit names per language: day, hour, minute.
const UNITS: Record<Lang, [string, string, string]> = { en: ["d", "h", "m"], tr: ["g", "sa", "dk"], de: ["T", "Std", "Min"] };

function fmtDuration(sec: number, lang: Lang) {
  const [D, H, M] = UNITS[lang];
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} ${D} ${h} ${H}` : h ? `${h} ${H} ${m} ${M}` : `${m} ${M}`;
}

export function systemValue(source: string, lang: Lang = "en"): string {
  switch (source) {
    case "@system.uptime":
      return fmtDuration(os.uptime(), lang);
    case "@system.memory": {
      const used = os.totalmem() - os.freemem();
      return `${Math.round((used / os.totalmem()) * 100)}%`;
    }
    case "@system.cpus":
      return String(os.cpus().length);
    case "@system.load":
      return os.loadavg()[0].toFixed(2);
    case "@system.host":
      return os.hostname();
    default:
      return "–";
  }
}
