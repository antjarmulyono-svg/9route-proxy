import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));

// google.js reaches upstream through fetchWithTimeout, not global fetch.
vi.mock("open-sse/services/usage/shared.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWithTimeout: mocks.fetchWithTimeout };
});

const { getAntigravityUsage } = await import("open-sse/services/usage/google.js");

// Shape taken from a real v1internal:fetchAvailableModels response for a paid
// Pro account (verified 2026-10-04): no claude-sonnet-4-6, six 5.5 tiers.
function paidModelsResponse() {
  const mk = (displayName) => ({
    displayName,
    quotaInfo: { remainingFraction: 0.5, resetTime: "2026-10-05T07:00:00Z" },
    supportsThinking: true,
    maxTokens: 1000000,
  });
  return {
    models: {
      "gemini-3.8-flash-high": mk("Gemini 3.8 Flash (High)"),
      "claude-sonnet-5-5-low": mk("Claude Sonnet 5.5 (Low)"),
      "claude-sonnet-5-5-medium": mk("Claude Sonnet 5.5 (Medium)"),
      "claude-sonnet-5-5-high": mk("Claude Sonnet 5.5 (High)"),
      "claude-opus-5-5-low": mk("Claude Opus 5.5 (Low)"),
      "claude-opus-5-5-medium": mk("Claude Opus 5.5 (Medium)"),
      "claude-opus-5-5-high": mk("Claude Opus 5.5 (High)"),
      tab_jump_flash_lite_preview: mk("internal"),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const payload = paidModelsResponse();
  mocks.fetchWithTimeout.mockImplementation(async (url) => {
    if (String(url).includes("loadCodeAssist")) {
      return { ok: true, status: 200, json: async () => ({ currentTier: { name: "Pro" } }) };
    }
    return { ok: true, status: 200, json: async () => payload };
  });
});

describe("Antigravity usage — paid-plan Claude 5.5 quotas", () => {
  it("reports a quota for every Claude 5.5 tier the account exposes", async () => {
    const usage = await getAntigravityUsage("tok", {});

    for (const id of [
      "claude-sonnet-5-5-low",
      "claude-sonnet-5-5-medium",
      "claude-sonnet-5-5-high",
      "claude-opus-5-5-low",
      "claude-opus-5-5-medium",
      "claude-opus-5-5-high",
    ]) {
      expect(usage.quotas[id], `missing quota for ${id}`).toBeDefined();
      expect(usage.quotas[id].remainingPercentage).toBe(50);
    }
  });

  it("returns the full upstream catalogue id list for routing", async () => {
    const usage = await getAntigravityUsage("tok", {});

    expect(usage.availableModelIds).toContain("claude-sonnet-5-5-medium");
    expect(usage.availableModelIds).not.toContain("claude-sonnet-4-6");
  });

  it("still omits internal preview models from the quota map", async () => {
    const usage = await getAntigravityUsage("tok", {});

    expect(usage.quotas.tab_jump_flash_lite_preview).toBeUndefined();
  });
});
