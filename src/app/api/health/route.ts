import { handleHealth } from "@/lib/api-handlers";

export const dynamic = "force-dynamic";

export function GET() {
  return handleHealth();
}
