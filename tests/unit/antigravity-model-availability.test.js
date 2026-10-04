import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
  selectProxyPool: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const {
  getAntigravityAvailabilityCache,
  resetAntigravityCatalogue,
  isAntigravityModelAvailable,
  refreshAntigravityQuota,
  getAntigravityQuotaCache,
} = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

// Google split the Antigravity catalogue by plan: free/trial accounts keep
// claude-sonnet-4-6, paid Pro accounts only expose claude-sonnet-5-5-*.
const FREE_MODELS = ["gemini-3.8-flash-high", "claude-sonnet-4-6", "claude-opus-4-6-thinking"];
const PAID_MODELS = ["gemini-3.8-flash-high", "claude-sonnet-5-5-medium", "claude-opus-5-5-high"];

function conn(id, email) {
  return { id, email, name: email, isActive: true, accessToken: `tok-${id}`, providerSpecificData: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  resetAntigravityCatalogue();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity per-account model availability", () => {
  it("treats a model as available when the account has no catalogue cached yet", () => {
    expect(isAntigravityModelAvailable("unknown-conn", "claude-sonnet-4-6")).toBe(true);
  });

  it("records the live catalogue for an account on quota refresh", async () => {
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { "claude-sonnet-5-5-medium": { remainingPercentage: 100, resetAt: null } },
      availableModelIds: PAID_MODELS,
    });

    await refreshAntigravityQuota("paid-1", "tok-paid-1", {});

    expect(getAntigravityAvailabilityCache().get("paid-1")).toEqual(PAID_MODELS);
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-5-5-medium")).toBe(true);
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-4-6")).toBe(false);
  });

  it("skips accounts whose live catalogue lacks the requested model", async () => {
    getAntigravityAvailabilityCache().set("paid-1", PAID_MODELS);
    getAntigravityAvailabilityCache().set("free-1", FREE_MODELS);
    mocks.getProviderConnections.mockResolvedValue([
      conn("paid-1", "paid@example.com"),
      conn("free-1", "free@example.com"),
    ]);

    const picked = await getProviderCredentials("antigravity", null, "claude-sonnet-4-6");

    expect(picked?.connectionId).toBe("free-1");
  });

  it("routes a 5.5 request only to the paid account that exposes it", async () => {
    getAntigravityAvailabilityCache().set("paid-1", PAID_MODELS);
    getAntigravityAvailabilityCache().set("free-1", FREE_MODELS);
    mocks.getProviderConnections.mockResolvedValue([
      conn("free-1", "free@example.com"),
      conn("paid-1", "paid@example.com"),
    ]);

    const picked = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5-medium");

    expect(picked?.connectionId).toBe("paid-1");
  });

  it("reports all accounts unavailable when no catalogue carries the model", async () => {
    getAntigravityAvailabilityCache().set("free-1", FREE_MODELS);
    getAntigravityAvailabilityCache().set("free-2", FREE_MODELS);
    mocks.getProviderConnections.mockResolvedValue([
      conn("free-1", "a@example.com"),
      conn("free-2", "b@example.com"),
    ]);

    const picked = await getProviderCredentials("antigravity", null, "claude-opus-5-5-high");

    expect(picked).toBeNull();
  });

  it("leaves non-antigravity providers untouched by the catalogue filter", async () => {
    getAntigravityAvailabilityCache().set("gh-1", ["only-this-model"]);
    mocks.getProviderConnections.mockResolvedValue([conn("gh-1", "gh@example.com")]);

    const picked = await getProviderCredentials("github", null, "claude-sonnet-4-6");

    expect(picked?.connectionId).toBe("gh-1");
  });
});
