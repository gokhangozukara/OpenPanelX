import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      name: "OpenPanelX",
      version: "0.4.0",
      uptime: Math.floor(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
