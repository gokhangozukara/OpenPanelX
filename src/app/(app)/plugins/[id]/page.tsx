import { notFound } from "next/navigation";
import { Sections } from "@/components/sections";
import { hasRole, requireUser } from "@/lib/auth";
import { getT, pick } from "@/lib/i18n";
import { getPlugin } from "@/lib/plugins";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plugin = getPlugin(id);
  const { lang } = await getT();
  return { title: plugin ? pick(plugin.name, lang) : "Plugin" };
}

export default async function PluginPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const plugin = getPlugin(id);
  if (!plugin || !hasRole(user, plugin.minRole)) notFound();
  const { t, lang } = await getT();

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{pick(plugin.name, lang)}</h1>
        {plugin.description && <p className="mt-1 text-muted">{pick(plugin.description, lang)}</p>}
      </header>
      <Sections plugin={plugin} lang={lang} t={t} canEdit={hasRole(user, "editor")} />
    </div>
  );
}
