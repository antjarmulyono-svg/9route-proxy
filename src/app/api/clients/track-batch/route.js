import { NextResponse } from "next/server";
import { recordClientActivity, normalizeIp } from "@/lib/db/repos/clientsRepo.js";

export async function POST(request) {
  try {
    const body = await request.json();
    const clients = body.clients || {};
    
    for (const [rawIp, info] of Object.entries(clients)) {
      const ip = normalizeIp(rawIp);
      if (!ip || ip === "127.0.0.1") continue;
      recordClientActivity(ip, {
        tool: info.tool ? `${info.tool.toUpperCase()} (MITM)` : "Antigravity IDE",
        category: "mitm",
        userAgent: info.lastHost || "",
        count: 0 // Heartbeat only, don't double count if request already counted
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
