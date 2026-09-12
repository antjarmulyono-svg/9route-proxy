/**
 * Single source of truth for proxy pool region + tier vocabulary.
 *
 * Shared by the dashboard UI, the REST layer, and the runtime selector so a
 * region/tier id never drifts between the three. Pools created before these
 * fields existed have no value stored, so every reader normalizes a missing
 * value to the defaults below rather than treating it as invalid.
 */

export const DEFAULT_PROXY_REGION = "global";
export const DEFAULT_PROXY_TIER = "free";

export const PROXY_REGIONS = [
  { id: "global", label: "Global / Anycast" },
  { id: "us-east", label: "US East" },
  { id: "us-west", label: "US West" },
  { id: "eu-west", label: "EU West" },
  { id: "eu-central", label: "EU Central" },
  { id: "ap-southeast", label: "Asia Pacific (Southeast)" },
  { id: "ap-northeast", label: "Asia Pacific (Northeast)" },
  { id: "ap-south", label: "Asia Pacific (South)" },
  { id: "sa-east", label: "South America East" },
];

// `rank` drives the graded fallback: a pool satisfies a requested tier when its
// own rank is greater than or equal to the requested rank.
export const PROXY_TIERS = [
  { id: "free", label: "Free", rank: 0 },
  { id: "pro", label: "Pro", rank: 1 },
  { id: "premium", label: "Premium", rank: 2 },
  { id: "enterprise", label: "Enterprise", rank: 3 },
];

const REGION_IDS = new Set(PROXY_REGIONS.map((r) => r.id));
const TIER_RANKS = new Map(PROXY_TIERS.map((t) => [t.id, t.rank]));

export function isValidRegion(id) {
  return typeof id === "string" && REGION_IDS.has(id);
}

export function isValidTier(id) {
  return typeof id === "string" && TIER_RANKS.has(id);
}

/**
 * Coerce any stored/user value into a known region id.
 * Unknown values fall back instead of throwing so legacy rows and batch
 * imports keep working after this field was introduced.
 */
export function normalizeRegion(id) {
  const value = typeof id === "string" ? id.trim() : "";
  return REGION_IDS.has(value) ? value : DEFAULT_PROXY_REGION;
}

export function normalizeTier(id) {
  const value = typeof id === "string" ? id.trim() : "";
  return TIER_RANKS.has(value) ? value : DEFAULT_PROXY_TIER;
}

/** Numeric rank of a tier; unknown tiers rank as the lowest tier. */
export function tierRank(id) {
  const rank = TIER_RANKS.get(typeof id === "string" ? id.trim() : "");
  return rank === undefined ? 0 : rank;
}

export function regionLabel(id) {
  return PROXY_REGIONS.find((r) => r.id === normalizeRegion(id))?.label || id;
}

export function tierLabel(id) {
  return PROXY_TIERS.find((t) => t.id === normalizeTier(id))?.label || id;
}
