import os from "node:os";
import Link from "next/link";
import { NavIcon } from "@/components/icons";
import { hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getT, pick, type T } from "@/lib/i18n";
import { listPlugins, systemValue } from "@/lib/plugins";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("dashboard") };
}

type AuditRow = { id: number; at: string; actor: string | null; action: string; detail: string | null };

// The log stores language-free codes; they are turned into a sentence in the reader's language here.
const ACTIONS: Record<string, Parameters<T>[0]> = {
  login: "actLogin",
  "login.failed": "actLoginFailed",
  "login.2fa-failed": "act2faFailed",
  "login.recovery-code": "actRecovery",
  setup: "actSetup",
  "user.add": "actUserAdd",
  "user.delete": "actUserDelete",
  "password.change": "actPasswordChange",
  "2fa.enable": "act2faEnable",
  "2fa.disable": "act2faDisable",
  "2fa.reset": "act2faReset",
  "row.add": "actRowAdd",
  "row.delete": "actRowDelete",
};

function describe(r: AuditRow, t: T): string {
  const key = ACTIONS[r.action];
  const label = key ? t(key) : r.action;
  // The first-admin note was stored in English; the sentence already says it, so drop it.
  if (!r.detail || r.action === "setup") return label;
  // "name (viewer)" -> "name (İzleyici)": show the role in the reader's language.
  const detail = r.detail.replace(/\((admin|editor|viewer)\)$/, (_, role) => `(${t(role)})`);
  return `${label} ${detail}`;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { t, lang } = await getT();
  const { denied } = await searchParams;

  const users = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const plugins = listPlugins().filter((p) => hasRole(user, p.minRole));
  const recent = db.prepare("SELECT id, at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 8").all() as AuditRow[];

  const stats = [
    { label: t("statUsers"), value: String(users) },
    { label: t("statPlugins"), value: String(plugins.length) },
    { label: t("statUptime"), value: systemValue("@system.uptime", lang) },
    { label: t("statMemory"), value: systemValue("@system.memory", lang) },
  ];

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("welcome")}, {user.username}
        </h1>
        <p className="mt-1 text-muted">{t("welcomeSub")}</p>
      </header>

      {denied && (
        <p role="alert" className="rounded-lg border border-line bg-soft px-4 py-3 text-sm">
          {t("denied")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-sm font-medium">{t("activity")}</h2>
          {recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("noActivity")}</p>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3 last:border-0">
                  <p className="min-w-0 truncate">
                    <span className="font-medium">{r.actor ?? "–"}</span>{" "}
                    <span className="text-muted">{describe(r, t)}</span>
                  </p>
                  <time className="shrink-0 text-xs text-muted tabular-nums">{r.at.slice(5, 16)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-sm font-medium">{t("plugins")}</h2>
          {plugins.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm font-medium">{t("noPlugins")}</p>
              <p className="mt-1 text-sm text-muted">{t("noPluginsHint")}</p>
            </div>
          ) : (
            <ul>
              {plugins.map((p) => (
                <li key={p.id} className="border-b border-line last:border-0">
                  <Link href={`/plugins/${p.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-soft">
                    <NavIcon name={p.icon} className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{pick(p.name, lang)}</span>
                      {p.description && <span className="block truncate text-xs text-muted">{pick(p.description, lang)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-muted">
        {os.hostname()} · Node {process.versions.node}
      </p>
    </div>
  );
}
