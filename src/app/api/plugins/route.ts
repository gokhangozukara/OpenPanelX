import { NextResponse } from "next/server";
import { getUser, hasRole } from "@/lib/auth";
import { listPlugins } from "@/lib/plugins";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plugins = listPlugins()
    .filter((p) => hasRole(user, p.minRole))
    .map(({ id, name, description, icon, minRole }) => ({ id, name, description, icon, minRole }));

  return NextResponse.json({ plugins }, { headers: { "Cache-Control": "no-store" } });
}
