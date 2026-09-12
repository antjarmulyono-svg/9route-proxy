import { describe, it, expect, vi, beforeEach } from "vitest";

// connectionProxy imports "@/models" at module load for pool lookups. The
// selector under test never touches the DB, so stub the module to keep the
// suite offline and fast.
vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async () => null),
}));

const { selectProxyPool, pickProxyPoolId } = await import(
  "@/lib/network/connectionProxy"
);
const {
  normalizeRegion,
  normalizeTier,
  tierRank,
  DEFAULT_PROXY_REGION,
  DEFAULT_PROXY_TIER,
} = await import("@/shared/constants/proxyPoolMeta");

function pool(id, extra = {}) {
  return {
    id,
    isActive: true,
    proxyUrl: `http://proxy/${id}`,
    ...extra,
  };
}

describe("proxyPoolMeta normalization", () => {
  it("falls back to defaults for unknown or missing values", () => {
    expect(normalizeRegion("mars-1")).toBe(DEFAULT_PROXY_REGION);
    expect(normalizeRegion(undefined)).toBe(DEFAULT_PROXY_REGION);
    expect(normalizeTier("ultra")).toBe(DEFAULT_PROXY_TIER);
    expect(normalizeTier(null)).toBe(DEFAULT_PROXY_TIER);
  });

  it("keeps known ids and trims whitespace", () => {
    expect(normalizeRegion(" ap-southeast ")).toBe("ap-southeast");
    expect(normalizeTier(" premium ")).toBe("premium");
  });

  it("ranks tiers in ascending order of privilege", () => {
    expect(tierRank("free")).toBe(0);
    expect(tierRank("pro")).toBe(1);
    expect(tierRank("premium")).toBe(2);
    expect(tierRank("enterprise")).toBe(3);
    expect(tierRank("bogus")).toBe(0);
  });
});

describe("selectProxyPool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no pool is usable", () => {
    expect(selectProxyPool([])).toBeNull();
    expect(
      selectProxyPool([pool("a", { isActive: false }), pool("b", { proxyUrl: "" })])
    ).toBeNull();
  });

  it("prefers the pool matching the requested region", () => {
    const pools = [
      pool("eu", { region: "eu-west", tier: "free" }),
      pool("ap", { region: "ap-southeast", tier: "free" }),
    ];
    expect(selectProxyPool(pools, { region: "ap-southeast" })).toBe("ap");
  });

  it("treats a global pool as a candidate for any region", () => {
    const pools = [pool("g", { region: "global", tier: "free" })];
    expect(selectProxyPool(pools, { region: "ap-northeast" })).toBe("g");
  });

  it("filters out pools below the minimum tier", () => {
    const pools = [
      pool("cheap", { region: "global", tier: "free" }),
      pool("rich", { region: "global", tier: "premium" }),
    ];
    expect(selectProxyPool(pools, { tier: "premium" })).toBe("rich");
    // enterprise outranks premium, so a premium request accepts it too
    const better = [pool("ent", { region: "global", tier: "enterprise" })];
    expect(selectProxyPool(better, { tier: "premium" })).toBe("ent");
  });

  it("relaxes tier first when region+tier finds nothing", () => {
    const pools = [
      pool("ap-free", { region: "ap-southeast", tier: "free" }),
      pool("eu-prem", { region: "eu-west", tier: "premium" }),
    ];
    // exact (ap-southeast + premium) misses → keep region, drop tier
    expect(selectProxyPool(pools, { region: "ap-southeast", tier: "premium" })).toBe(
      "ap-free"
    );
  });

  it("relaxes region when no regional pool exists at all", () => {
    const pools = [pool("eu-prem", { region: "eu-west", tier: "premium" })];
    expect(selectProxyPool(pools, { region: "sa-east", tier: "premium" })).toBe(
      "eu-prem"
    );
  });

  it("falls back to any usable pool when every preference misses", () => {
    const pools = [pool("eu-free", { region: "eu-west", tier: "free" })];
    expect(selectProxyPool(pools, { region: "sa-east", tier: "enterprise" })).toBe(
      "eu-free"
    );
  });

  it("round-robins within the filtered candidate set only", () => {
    const pools = [
      pool("ap1", { region: "ap-southeast", tier: "pro" }),
      pool("ap2", { region: "ap-southeast", tier: "pro" }),
      pool("eu1", { region: "eu-west", tier: "pro" }),
    ];
    const opts = {
      region: "ap-southeast",
      tier: "pro",
      strategy: "round-robin",
      providerId: "rr-test",
    };
    const picks = [
      selectProxyPool(pools, opts),
      selectProxyPool(pools, opts),
      selectProxyPool(pools, opts),
      selectProxyPool(pools, opts),
    ];
    // rotation state starts at -1, so the first call lands on index 0
    expect(picks).toEqual(["ap1", "ap2", "ap1", "ap2"]);
    expect(picks).not.toContain("eu1");
  });

  it("treats legacy pools without region/tier as global/free", () => {
    const pools = [pool("legacy")];
    expect(selectProxyPool(pools, { region: "us-east" })).toBe("legacy");
    expect(selectProxyPool(pools, { tier: "free" })).toBe("legacy");
  });

  it("keeps pickProxyPoolId working for plain id lists", () => {
    expect(pickProxyPoolId(["a", "b"], "none", "p")).toBe("a");
    expect(pickProxyPoolId([], "none", "p")).toBeNull();
  });
});
