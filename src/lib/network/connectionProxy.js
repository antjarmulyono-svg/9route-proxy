import { getProxyPoolById } from "@/models";
import { normalizeRegion, tierRank } from "@/shared/constants/proxyPoolMeta";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Apply the rotation strategy across an already-filtered candidate list.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
function applyStrategy(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

/**
 * Pick one proxy pool ID from a list based on strategy.
 * Kept for callers that rotate over a pre-built id list with no geo/quality
 * preference; region/tier-aware callers should use selectProxyPool instead.
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  return applyStrategy(poolIds, strategy, providerId);
}

/**
 * Select a proxy pool honouring region and minimum-tier preferences.
 *
 * Matching is graded rather than strict: a request for `ap-southeast` +
 * `premium` that finds nothing must still be routed, so the filters are
 * relaxed one at a time (tier first, then region) before giving up on
 * preferences entirely. Failing closed here would turn a missing pool into a
 * hard request failure, which is worse than routing through a less ideal exit.
 *
 * @param {Array} pools            candidate pools (any active state)
 * @param {object} options
 * @param {string} [options.region] preferred region id
 * @param {string} [options.tier]   minimum acceptable tier id
 * @param {string} [options.strategy] rotation strategy within the matches
 * @param {string} [options.providerId] rotation bucket key
 * @returns {string|null} chosen pool id
 */
export function selectProxyPool(pools, options = {}) {
  const { region, tier, strategy = "none", providerId = "" } = options;

  // A pool without a URL cannot carry traffic regardless of its metadata.
  const usable = (pools || []).filter(
    (pool) => pool && pool.isActive === true && normalizeString(pool.proxyUrl)
  );
  if (usable.length === 0) return null;

  const wantedRegion = normalizeString(region);
  const wantedTier = normalizeString(tier);
  const minRank = wantedTier ? tierRank(wantedTier) : null;

  // A "global" pool is an anycast/edge exit with no fixed geography, so it is
  // a valid candidate for every requested region.
  const matchesRegion = (pool) =>
    !wantedRegion ||
    normalizeRegion(pool.region) === wantedRegion ||
    normalizeRegion(pool.region) === "global";

  const matchesTier = (pool) => minRank === null || tierRank(pool.tier) >= minRank;

  const tiers = [
    usable.filter((pool) => matchesRegion(pool) && matchesTier(pool)),
    usable.filter(matchesRegion), // relax tier
    usable.filter(matchesTier), // relax region
    usable, // relax everything
  ];

  const candidates = tiers.find((list) => list.length > 0) || [];
  return applyStrategy(candidates.map((pool) => pool.id), strategy, providerId);
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}
