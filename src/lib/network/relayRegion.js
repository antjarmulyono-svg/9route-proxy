/**
 * Detect which geographic region a deployed relay actually answers from.
 *
 * A relay's region cannot be known from the deploy API response: all three
 * platforms run the function on an anycast edge, so the exit location depends
 * on where the request enters the network. The only reliable source is the
 * relay's own response headers, which every platform stamps with the edge that
 * served the call.
 *
 * Detection is best-effort by design. A relay that is reachable but does not
 * expose a recognisable header is still a working relay, so an unknown result
 * falls back to "global" rather than failing the deploy that just succeeded.
 */

import { DEFAULT_PROXY_REGION, normalizeRegion } from "@/shared/constants/proxyPoolMeta";

/**
 * Vercel edge identifiers, taken from the `x-vercel-id` header
 * (format: "sin1::abc-123" or "sin1::sin1::abc-123").
 */
const VERCEL_EDGE_REGIONS = {
  iad1: "us-east",
  cle1: "us-east",
  sfo1: "us-west",
  pdx1: "us-west",
  lax1: "us-west",
  dub1: "eu-west",
  lhr1: "eu-west",
  cdg1: "eu-west",
  fra1: "eu-central",
  arn1: "eu-central",
  sin1: "ap-southeast",
  syd1: "ap-southeast",
  hnd1: "ap-northeast",
  icn1: "ap-northeast",
  kix1: "ap-northeast",
  bom1: "ap-south",
  gru1: "sa-east",
};

/**
 * Cloudflare colo codes, taken from the trailing segment of `cf-ray`
 * (format: "7f2a1b3c4d5e6f7g-SIN"). These are IATA airport codes.
 */
const CLOUDFLARE_COLO_REGIONS = {
  IAD: "us-east",
  EWR: "us-east",
  ATL: "us-east",
  MIA: "us-east",
  ORD: "us-east",
  SJC: "us-west",
  LAX: "us-west",
  SEA: "us-west",
  DFW: "us-west",
  LHR: "eu-west",
  DUB: "eu-west",
  CDG: "eu-west",
  MAD: "eu-west",
  FRA: "eu-central",
  AMS: "eu-central",
  ARN: "eu-central",
  WAW: "eu-central",
  SIN: "ap-southeast",
  CGK: "ap-southeast",
  KUL: "ap-southeast",
  BKK: "ap-southeast",
  SYD: "ap-southeast",
  HKG: "ap-northeast",
  NRT: "ap-northeast",
  KIX: "ap-northeast",
  ICN: "ap-northeast",
  TPE: "ap-northeast",
  BOM: "ap-south",
  DEL: "ap-south",
  MAA: "ap-south",
  GRU: "sa-east",
  EZE: "sa-east",
  SCL: "sa-east",
};

/**
 * Deno Deploy regions, taken from the `server` header
 * (format: "deno/gcp-asia-southeast1").
 */
const DENO_REGION_PREFIXES = [
  ["asia-southeast", "ap-southeast"],
  ["asia-northeast", "ap-northeast"],
  ["asia-south", "ap-south"],
  ["asia-east", "ap-northeast"],
  ["us-east", "us-east"],
  ["us-central", "us-east"],
  ["us-west", "us-west"],
  ["northamerica-northeast", "us-east"],
  ["europe-west", "eu-west"],
  ["europe-north", "eu-central"],
  ["europe-central", "eu-central"],
  ["southamerica-east", "sa-east"],
];

/** Extract the edge code from `x-vercel-id`, which may repeat the region. */
export function regionFromVercelId(headerValue) {
  const code = String(headerValue || "").split("::")[0].trim().toLowerCase();
  return VERCEL_EDGE_REGIONS[code] || null;
}

/** Extract the colo code from the tail of `cf-ray`. */
export function regionFromCfRay(headerValue) {
  const parts = String(headerValue || "").split("-");
  if (parts.length < 2) return null;
  const colo = parts[parts.length - 1].trim().toUpperCase();
  return CLOUDFLARE_COLO_REGIONS[colo] || null;
}

/** Match the GCP region embedded in Deno Deploy's `server` header. */
export function regionFromDenoServer(headerValue) {
  const value = String(headerValue || "").trim().toLowerCase();
  if (!value.startsWith("deno/")) return null;
  const match = DENO_REGION_PREFIXES.find(([prefix]) => value.includes(prefix));
  return match ? match[1] : null;
}

/**
 * Read a relay's region from its live response headers.
 *
 * The relay itself requires an `x-relay-target` header and answers 400 without
 * one, but the platform stamps its edge headers on that 400 just the same, so
 * no upstream provider needs to be contacted to learn the region.
 *
 * @param {string} relayUrl        deployed relay URL
 * @param {object} [options]
 * @param {number} [options.timeoutMs] abort budget, default 8s
 * @param {Function} [options.fetchImpl] injectable fetch, for tests
 * @returns {Promise<{region: string, detected: boolean, edge: string}>}
 */
export async function detectRelayRegion(relayUrl, options = {}) {
  const { timeoutMs = 8000, fetchImpl = fetch } = options;
  const unknown = { region: DEFAULT_PROXY_REGION, detected: false, edge: "" };

  const url = String(relayUrl || "").trim();
  if (!url) return unknown;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "user-agent": "9router-region-probe" },
    });

    const headers = res.headers;
    const vercelId = headers.get("x-vercel-id") || "";
    const cfRay = headers.get("cf-ray") || "";
    const server = headers.get("server") || "";

    const region =
      regionFromVercelId(vercelId) ||
      regionFromCfRay(cfRay) ||
      regionFromDenoServer(server);

    if (!region) {
      return { ...unknown, edge: vercelId || cfRay || server };
    }

    return {
      region: normalizeRegion(region),
      detected: true,
      edge: vercelId || cfRay || server,
    };
  } catch {
    // A probe failure says nothing about whether the relay works — the deploy
    // already reported ready. Keep the default region and let the user set it.
    return unknown;
  } finally {
    clearTimeout(timer);
  }
}
