import { NextResponse } from "next/server";
import { createProxyPool, getProviderConnections, getProxyPools } from "@/models";
import { normalizeRegion, normalizeTier } from "@/shared/constants/proxyPoolMeta";

function toBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const VALID_PROXY_TYPES = ["http", "vercel", "cloudflare", "deno"];

function normalizeProxyPoolInput(body = {}) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  const noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  const isActive = body?.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body?.strictProxy === true;
  // Unknown region/tier values coerce to defaults rather than rejecting, so
  // batch imports and older clients that omit them keep succeeding.
  const region = normalizeRegion(body?.region);
  const tier = normalizeTier(body?.tier);
  let type = VALID_PROXY_TYPES.includes(body?.type) ? body.type : "http";

  if (type === "http" && proxyUrl) {
    if (proxyUrl.includes(".workers.dev")) type = "cloudflare";
    else if (proxyUrl.includes(".vercel.app")) type = "vercel";
    else if (proxyUrl.includes(".deno.dev")) type = "deno";
  }

  if (!name) {
    return { error: "Name is required" };
  }

  if (!proxyUrl) {
    return { error: "Proxy URL is required" };
  }

  return { name, proxyUrl, noProxy, isActive, strictProxy, type, region, tier };
}

function buildUsageMap(connections = []) {
  const usageMap = new Map();

  for (const connection of connections) {
    const proxyPoolId = connection?.providerSpecificData?.proxyPoolId;
    if (!proxyPoolId) continue;

    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) || 0) + 1);
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";
    const region = searchParams.get("region");
    const tier = searchParams.get("tier");

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    let proxyPools = await getProxyPools(filter);

    // region/tier live inside the JSON `data` column, so they can't be pushed
    // into the SQL WHERE clause and are filtered here instead.
    if (region) {
      proxyPools = proxyPools.filter((pool) => pool.region === region);
    }
    if (tier) {
      proxyPools = proxyPools.filter((pool) => pool.tier === tier);
    }

    if (!includeUsage) {
      return NextResponse.json({ proxyPools });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => ({
      ...pool,
      boundConnectionCount: usageMap.get(pool.id) || 0,
    }));

    return NextResponse.json({ proxyPools: enrichedProxyPools });
  } catch (error) {
    console.log("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
export async function POST(request) {
  try {
    const body = await request.json();
    const normalized = normalizeProxyPoolInput(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool(normalized);
    return NextResponse.json({ proxyPool }, { status: 201 });
  } catch (error) {
    console.log("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}
