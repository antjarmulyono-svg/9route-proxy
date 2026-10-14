import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { syncAntigravityCatalogueFromDb } from "@/sse/services/antigravityQuota";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/antigravity/reset-catalogue
 *
 * Flushes in-memory availability cache and transient not-found exclusions,
 * then re-seeds the cache directly from all active Antigravity connections
 * in the database. Allows runtime catalogue updates without restarting 9router.
 */
export async function POST() {
  try {
    const connections = await getProviderConnections({
      provider: "antigravity",
      isActive: true,
    });

    const result = syncAntigravityCatalogueFromDb(connections);

    return NextResponse.json({
      status: "ok",
      message: "Antigravity catalogue cache reset and resynced from database",
      data: {
        activeAccounts: connections.length,
        syncedAccounts: result.syncedAccounts,
        totalModels: result.totalModels,
      },
    });
  } catch (error) {
    console.error("[Antigravity Reset Catalogue] Error:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error.message || "Failed to reset catalogue",
      },
      { status: 500 }
    );
  }
}
