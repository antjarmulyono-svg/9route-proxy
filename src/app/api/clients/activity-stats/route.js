import { NextResponse } from "next/server";
import { getClientActivityStats, getAllClients } from "@/lib/db/repos/clientsRepo";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "24h";
    const ip = searchParams.get("ip") || "all";

    const [stats, clients] = await Promise.all([
      getClientActivityStats(period, ip),
      getAllClients(),
    ]);

    return NextResponse.json({
      ok: true,
      stats,
      clients: clients.map((c) => ({
        ip: c.ip,
        name: c.name,
        tool: c.tool,
        category: c.category,
        requestCount: c.requestCount,
        lastSeen: c.lastSeen,
      })),
    });
  } catch (error) {
    console.error("[api/clients/activity-stats] Error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
