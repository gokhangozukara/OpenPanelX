import { NextResponse } from "next/server";
import { getUser, hasRole } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { getPlugin, systemValue, tableRows } from "@/lib/plugins";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const plugin = getPlugin(id);
  if (!plugin || !hasRole(user, plugin.minRole)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lang = await getLang();
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

  return NextResponse.json(
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
