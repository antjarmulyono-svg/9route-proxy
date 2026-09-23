// Pool egress geo — engine layer, shared by the dashboard UI (Proxy Fitness /
// Proxy Pools egress column) and any provider region policy that wants to
// pre-mark pools unfit by egress region.

const GEO_STATE_KEY = "__9routerPoolGeo__";
const geoCache = (globalThis[GEO_STATE_KEY] ??= new Map()); // poolId -> { ip, country, ..., ts, ipHistory }

export const POOL_GEO_TTL_MS = 60 * 60 * 1000;
export const POOL_GEO_IP_HISTORY_MAX = 8;

export function resetPoolGeo() {
  geoCache.clear();
}

function withStability(entry) {
  const ips = new Set([entry?.ip, ...(entry?.ipHistory || []).map((h) => h.ip)]);
  ips.delete("");
  const ipCount = ips.size;
  return { ...entry, ipCount, isUnstable: ipCount >= 2 };
}

export function getPoolGeo(poolId) {
  const entry = geoCache.get(poolId);
  if (!entry) return null;
  if (entry.ts + POOL_GEO_TTL_MS < Date.now()) {
    geoCache.delete(poolId);
    return null;
  }
  return withStability(entry);
}

export function setPoolGeo(poolId, geo) {
  if (!poolId || !geo?.ip) return;
  const prev = geoCache.get(poolId);
  const ipHistory = prev?.ipHistory ? [...prev.ipHistory] : [];
  if (prev?.ip && prev.ip !== geo.ip) {
    ipHistory.push({ ip: prev.ip, ts: Date.now() });
    if (ipHistory.length > POOL_GEO_IP_HISTORY_MAX) ipHistory.shift();
  }
  geoCache.set(poolId, { ...geo, ts: Date.now(), ipHistory });
}

export function poolGeoSnapshot(now = Date.now()) {
  const out = {};
  for (const [poolId, entry] of geoCache) {
    if (entry.ts + POOL_GEO_TTL_MS <= now) {
      geoCache.delete(poolId);
      continue;
    }
    out[poolId] = withStability(entry);
  }
  return out;
}

export function pruneStaleGeo(now = Date.now()) {
  let removed = 0;
  for (const [poolId, entry] of geoCache) {
    if (entry.ts + POOL_GEO_TTL_MS <= now) {
      geoCache.delete(poolId);
      removed += 1;
    }
  }
  return removed;
}

const GEO_PARSE = {
  "ipwho.is": (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org || d?.connection?.org }),
  "ip-api": (d) => ({ ip: d?.query, country: d?.country, region: d?.regionName, city: d?.city, org: d?.org }),
  "ipapi.co": (d) => ({ ip: d?.ip, country: d?.country_name, region: d?.region, city: d?.city, org: d?.org }),
  ipinfo: (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org }),
};

const GEO_PROBES = [
  { name: "ipwho.is", url: "https://ipwho.is/" },
  { name: "ip-api", url: "https://ip-api.com/json/?fields=status,message,query,country,regionName,city,org" },
  { name: "ipapi.co", url: "https://ipapi.co/json/" },
  { name: "ipinfo", url: "https://ipinfo.io/json" },
];

function customGeoParse(d) {
  if (!d || typeof d !== "object") return null;
  const pick = (...keys) => keys.map((k) => d[k]).find((v) => v != null && v !== "");
  return {
    ip: pick("query", "ip"),
    country: pick("country", "country_name", "countryName"),
    region: pick("regionName", "region", "state", "regionCode"),
    city: pick("city"),
    org: pick("org", "organization", "isp", "orgName", "connection", "asn"),
  };
}

function probeSource({ proxyAwareFetch, url, proxyOptions, timeoutMs, name }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("geo probe timeout")), timeoutMs);
  return (async () => {
    try {
      const res = await proxyAwareFetch(url, { signal: ctrl.signal }, proxyOptions);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const error = res.status === 429 || res.status === 403 ? "rate-limit"
          : res.status >= 500 ? "server"
          : "network";
        return { ok: false, error, detail: `${res.status} ${txt.slice(0, 80)}` };
      }
      const data = await res.json().catch(() => null);
      const parsed = name ? GEO_PARSE[name]?.(data) : customGeoParse(data);
      if (!parsed?.ip) return { ok: false, error: "no-ip", detail: `${name || "custom"}` };
      return {
        ok: true,
        geo: {
          ip: String(parsed.ip || "").trim(),
          country: String(parsed.country || "").trim(),
          region: String(parsed.region || "").trim(),
          city: String(parsed.city || "").trim(),
          org: String(parsed.org || "").trim(),
          isDatacenter: /(cloudflare|vercel|amazon|aws|google|microsoft|azure|digitalocean|hetzner|ovh|contabo|leaseweb)/i.test(
            String(parsed.org || ""),
          ),
        },
      };
    } catch (error) {
      const timedOut = ctrl.signal?.aborted && error?.name === "AbortError";
      return { ok: false, error: timedOut ? "timeout" : "network", detail: `${error?.name}: ${error?.message}` };
    } finally {
      clearTimeout(timer);
    }
  })();
}

export async function probePoolGeo(pool, timeoutMs = 15000) {
  const proxyUrl = pool?.proxyUrl;
  if (!proxyUrl) return { ok: false, error: "network", detail: "no proxy url" };
  const { proxyAwareFetch } = await import("../utils/proxyFetch.js");
  const isRelay = ["vercel", "cloudflare", "deno"].includes(pool?.type);
  const proxyOptions = isRelay
    ? { vercelRelayUrl: proxyUrl }
    : { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl };

  const custom = process.env.GEO_PROBE_URL ? [{ name: null, url: process.env.GEO_PROBE_URL }] : [];
  const probes = custom.length ? custom : GEO_PROBES;

  let last = { ok: false, error: "network", detail: "no provider responded" };
  for (const p of probes) {
    const res = await probeSource({ proxyAwareFetch, url: p.url, proxyOptions, timeoutMs, name: p.name });
    if (res.ok) return res;
    if (res.error === "rate-limit" || res.error === "server") last = res;
    else if (last.error === "network") last = res;
  }
  return last;
}
