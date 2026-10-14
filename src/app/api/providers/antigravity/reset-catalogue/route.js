import { NextResponse } from "next/server";
import { getProviderConnections, validateApiKey } from "@/models";
import { syncAntigravityCatalogueFromDb } from "@/sse/services/antigravityQuota";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/antigravity/reset-catalogue
 *
 * Flushes in-memory availability cache and transient not-found exclusions,
 * then re-seeds the cache directly from all active Antigravity connections
 * in the database. Allows runtime catalogue updates without restarting 9router.
 *
 * Authorization: requires either an active 9Router API key (Bearer token)
 * OR an authenticated dashboard session cookie.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const cookieToken = request.cookies?.get("auth_token")?.value;

    const isValidApiKey = bearerKey ? await validateApiKey(bearerKey) : false;
    const isValidSession = cookieToken ? await verifyDashboardAuthToken(cookieToken) : false;

    if (!isValidApiKey && !isValidSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
