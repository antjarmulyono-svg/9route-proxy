import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
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
  recordAntigravityModelNotFound,
} = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

function conn(id, email, extra = {}) {
  return { id, email, name: email, isActive: true, accessToken: `tok-${id}`, providerSpecificData: {}, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAntigravityCatalogue();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity catalogue persistence to DB", () => {
  it("uses availableModelIds from DB connection object if RAM cache is cold", () => {
    // RAM cache is empty after restart
    expect(getAntigravityAvailabilityCache().get("paid-cold")).toBeUndefined();

    const connectionFromDb = conn("paid-cold", "paid@example.com", {
      availableModelIds: ["claude-sonnet-5-5-medium", "gemini-3.8-flash-high"],
    });

    // Should recognize availability from connection object and populate RAM cache
    expect(isAntigravityModelAvailable("paid-cold", "claude-sonnet-5-5-medium", connectionFromDb)).toBe(true);
    expect(isAntigravityModelAvailable("paid-cold", "claude-sonnet-4-6", connectionFromDb)).toBe(false);
    expect(getAntigravityAvailabilityCache().get("paid-cold")).toContain("claude-sonnet-5-5-medium");
  });

  it("filters accounts on cold start based on DB-persisted availableModelIds", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("free-cold", "free@example.com", {
        availableModelIds: ["claude-sonnet-4-6", "gemini-3.8-flash-high"],
      }),
      conn("paid-cold", "paid@example.com", {
        availableModelIds: ["claude-sonnet-5-5-medium", "gemini-3.8-flash-high"],
      }),
    ]);

    // Requesting 5.5 should immediately route to paid-cold without needing an upstream probe
    const picked = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5-medium");
    expect(picked?.connectionId).toBe("paid-cold");
  });

  it("persists learned catalogue to DB when refreshAntigravityQuota runs", async () => {
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { "claude-sonnet-5-5-medium": { remainingPercentage: 100, resetAt: null } },
      availableModelIds: ["claude-sonnet-5-5-medium", "gemini-3.8-flash-high"],
    });

    await refreshAntigravityQuota("paid-1", "tok-paid-1", {});

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "paid-1",
      expect.objectContaining({
        availableModelIds: ["claude-sonnet-5-5-medium", "gemini-3.8-flash-high"],
      })
    );
  });

  it("prunes model from DB availableModelIds when 404/refusal is recorded", async () => {
    getAntigravityAvailabilityCache().set("paid-1", ["claude-sonnet-4-6", "claude-sonnet-5-5-medium"]);

    recordAntigravityModelNotFound("paid-1", "claude-sonnet-4-6");

    expect(getAntigravityAvailabilityCache().get("paid-1")).not.toContain("claude-sonnet-4-6");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "paid-1",
      expect.objectContaining({
        availableModelIds: ["claude-sonnet-5-5-medium"],
      })
    );
  });
});
