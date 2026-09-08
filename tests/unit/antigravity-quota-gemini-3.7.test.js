import { describe, expect, it, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }
    : {
        models: {
          "gemini-3.7-flash-high": {
            displayName: "Gemini 3.7 Flash (High)",
            quotaInfo: { remainingFraction: 0.85, resetTime: "2026-08-25T12:00:00Z" },
          },
          "gemini-3.7-flash-medium": {
            displayName: "Gemini 3.7 Flash (Medium)",
            quotaInfo: { remainingFraction: 0.6, resetTime: "2026-08-25T12:00:00Z" },
          },
          "gemini-3.7-flash-low": {
            displayName: "Gemini 3.7 Flash (Low)",
            quotaInfo: { remainingFraction: 0.35, resetTime: "2026-08-25T12:00:00Z" },
          },
          "internal-model": {
            displayName: "Internal",
            isInternal: true,
            quotaInfo: { remainingFraction: 0.5 },
          },
        },
      },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity quota tracker: Gemini 3.7 Flash usage bars", () => {
  beforeEach(() => proxyAwareFetch.mockClear());

  it("returns Gemini 3.7 Flash tier quotas so the dashboard can render usage bars", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.7-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
      displayName: "Gemini 3.7 Flash (High)",
    });
    expect(usage.quotas["gemini-3.7-flash-medium"]).toMatchObject({
      used: 400,
      total: 1000,
      remainingPercentage: 60,
    });
    expect(usage.quotas["gemini-3.7-flash-low"]).toMatchObject({
      used: 650,
      total: 1000,
      remainingPercentage: 35,
    });
    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
      displayName: "Gemini 3.8 Flash (High)",
    });
    expect(usage.quotas["gemini-3.8-flash-medium"]).toMatchObject({
      used: 400,
      total: 1000,
      remainingPercentage: 60,
      displayName: "Gemini 3.8 Flash (Medium)",
    });
    expect(usage.quotas["gemini-3.8-flash-low"]).toMatchObject({
      used: 650,
      total: 1000,
      remainingPercentage: 35,
      displayName: "Gemini 3.8 Flash (Low)",
    });
  });

  it("parses gemini-3.8-flash-tiered directly when present from daily upstream", async () => {
    proxyAwareFetch.mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.includes(":loadCodeAssist")
        ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }
        : {
            models: {
              "gemini-3.8-flash-tiered": {
                displayName: "Gemini 3.8 Flash (Tiered)",
                quotaInfo: { remainingFraction: 0.74, resetTime: "2026-09-09T02:00:00Z" },
              },
              "gemini-3.7-flash-tiered": {
                displayName: "Gemini 3.7 Flash (Tiered)",
                quotaInfo: { remainingFraction: 0.90, resetTime: "2026-09-09T02:00:00Z" },
              },
            },
          },
      text: async () => "{}",
    }));

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 260,
      total: 1000,
      remainingPercentage: 74,
      displayName: "Gemini 3.8 Flash (High)",
    });
    expect(usage.quotas["gemini-3.7-flash-high"]).toMatchObject({
      used: 100,
      total: 1000,
      remainingPercentage: 90,
      displayName: "Gemini 3.7 Flash (High)",
    });
  });
});
