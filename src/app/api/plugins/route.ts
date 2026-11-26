import { handleListPlugins } from "@/lib/api-handlers";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleListPlugins(await getUser());
}
