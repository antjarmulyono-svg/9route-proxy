import { NextResponse } from "next/server";
import { toggleClient } from "@/lib/db/repos/clientsRepo.js";
import { syncClientsToJson } from "@/lib/mitmClientCache.js";

export async function POST(request) {
  try {
    const { ip, enabled } = await request.json();
    if (!ip) {
      return NextResponse.json({ ok: false, error: "IP address is required" }, { status: 400 });
    }

    const updated = await toggleClient(ip, enabled);
    await syncClientsToJson();
    return NextResponse.json({ ok: true, client: updated });
  } catch (error) {
    console.error("[api/clients/toggle] error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
