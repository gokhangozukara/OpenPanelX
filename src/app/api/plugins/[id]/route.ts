import { handleGetPlugin } from "@/lib/api-handlers";
import { getUser } from "@/lib/auth";
import { getLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleGetPlugin(await getUser(), id, await getLang());
}
