import { NextResponse } from "next/server";
import { clearAllPoolUnfit, ensurePoolFitnessHydrated } from "open-sse/services/proxyPoolFitness.js";

export async function POST(request) {
  try {
    await ensurePoolFitnessHydrated();
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const provider = typeof body?.provider === "string" && body.provider.trim() ? body.provider.trim() : null;
    clearAllPoolUnfit(provider);
    return NextResponse.json({ ok: true, provider: provider || null });
  } catch (error) {
    console.log("Error clearing proxy fitness:", error);
    return NextResponse.json({ error: "Failed to clear proxy fitness" }, { status: 500 });
  }
}
