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
  isAntigravityModelRefusal,
  recordAntigravityModelNotFound,
} = await import("@/sse/services/antigravityQuota.js");

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  resetAntigravityCatalogue();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity in-body model refusal", () => {
  // Observed verbatim in production: a paid account that no longer carries the
  // 4.6 generation answers HTTP 200 with the refusal as assistant text, so the
  // 404 path never sees it.
  it("recognises the upstream refusal sentence", () => {
    expect(
      isAntigravityModelRefusal("Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.")
    ).toBe(true);
  });

  it("recognises the Opus wording and ignores surrounding whitespace", () => {
    expect(
      isAntigravityModelRefusal("  Claude Opus 4.6 is no longer available. Please switch to Claude Opus 5.5.  ")
    ).toBe(true);
  });

  it("does not flag a normal completion that merely mentions a model name", () => {
    expect(isAntigravityModelRefusal("Claude Sonnet 4.6 is a good model for this task.")).toBe(false);
    expect(isAntigravityModelRefusal("OK")).toBe(false);
    expect(isAntigravityModelRefusal("")).toBe(false);
    expect(isAntigravityModelRefusal(null)).toBe(false);
  });

  it("excludes the account for that model once the refusal is recorded", () => {
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-4-6")).toBe(true);

    recordAntigravityModelNotFound("paid-1", "claude-sonnet-4-6");

    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-4-6")).toBe(false);
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-5-5-medium")).toBe(true);
  });
});
