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
  getAntigravityQuotaCache,
  isAntigravityModelAvailable,
  recordAntigravityModelNotFound,
} = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

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

describe("Antigravity catalogue learning from upstream 404", () => {
  it("marks the model unavailable for that account after a NOT_FOUND", () => {
    expect(isAntigravityModelAvailable("free-1", "claude-sonnet-5-5-medium")).toBe(true);

    recordAntigravityModelNotFound("free-1", "claude-sonnet-5-5-medium");

    expect(isAntigravityModelAvailable("free-1", "claude-sonnet-5-5-medium")).toBe(false);
  });

  it("keeps every other model on that account routable", () => {
    recordAntigravityModelNotFound("free-1", "claude-sonnet-5-5-medium");

    expect(isAntigravityModelAvailable("free-1", "claude-sonnet-4-6")).toBe(true);
    expect(isAntigravityModelAvailable("free-1", "gemini-3.8-flash-high")).toBe(true);
  });

  it("does not leak the exclusion to a different account", () => {
    recordAntigravityModelNotFound("free-1", "claude-sonnet-5-5-medium");

    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-5-5-medium")).toBe(true);
  });

  it("stops routing that account for the model on the next request", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("free-1", "free@example.com"),
      conn("paid-1", "paid@example.com"),
    ]);

    recordAntigravityModelNotFound("free-1", "claude-sonnet-5-5-medium");
    const picked = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5-medium");

    expect(picked?.connectionId).toBe("paid-1");
  });

  it("removes the exclusion when a later quota refresh proves the model is back", async () => {
    const { refreshAntigravityQuota } = await import("@/sse/services/antigravityQuota.js");
    recordAntigravityModelNotFound("free-1", "claude-sonnet-5-5-medium");
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { "claude-sonnet-5-5-medium": { remainingPercentage: 100, resetAt: null } },
      availableModelIds: ["claude-sonnet-5-5-medium", "gemini-3.8-flash-high"],
    });

    await refreshAntigravityQuota("free-1", "tok-free-1", {});

    expect(isAntigravityModelAvailable("free-1", "claude-sonnet-5-5-medium")).toBe(true);
  });
});
