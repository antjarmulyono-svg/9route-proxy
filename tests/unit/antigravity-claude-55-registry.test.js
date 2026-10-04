import { describe, expect, it } from "vitest";

const antigravity = (await import("open-sse/providers/registry/antigravity.js")).default;
const { MODEL_CAPABILITIES } = await import("open-sse/providers/capabilities.js");

// Live upstream catalogue for a paid Pro account (verified against
// v1internal:fetchAvailableModels on 2026-10-04): claude-sonnet-4-6 is gone and
// replaced by three reasoning tiers per Claude family.
const PAID_CLAUDE_IDS = [
  "claude-sonnet-5-5-low",
  "claude-sonnet-5-5-medium",
  "claude-sonnet-5-5-high",
  "claude-opus-5-5-low",
  "claude-opus-5-5-medium",
  "claude-opus-5-5-high",
];

// Google's own tagDescription says third-party access ends on this date.
const SUNSET_IDS = ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"];
const SUNSET_DATE = "2026-11-02";

function modelById(id) {
  return antigravity.models.find((m) => m.id === id);
}

describe("Antigravity registry — Claude 5.5 paid-plan catalogue", () => {
  it.each(PAID_CLAUDE_IDS)("registers %s", (id) => {
    expect(modelById(id)).toBeDefined();
  });

  it("names each 5.5 tier the way the upstream displayName does", () => {
    expect(modelById("claude-sonnet-5-5-medium").name).toBe("Claude Sonnet 5.5 (Medium)");
    expect(modelById("claude-opus-5-5-high").name).toBe("Claude Opus 5.5 (High)");
  });

  it("keeps the 4.6 models registered so free-plan accounts still route", () => {
    expect(modelById("claude-sonnet-4-6")).toBeDefined();
    expect(modelById("claude-opus-4-6-thinking")).toBeDefined();
  });

  it("declares a 1M context window and reasoning support for every 5.5 tier", () => {
    for (const id of PAID_CLAUDE_IDS) {
      const caps = MODEL_CAPABILITIES[id];
      expect(caps, `missing capabilities for ${id}`).toBeDefined();
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBe(1000000);
    }
  });

  it.each(SUNSET_IDS)("marks %s as sunsetting on 2026-11-02", (id) => {
    expect(modelById(id).sunsetOn).toBe(SUNSET_DATE);
  });

  it("leaves models without an announced removal date unmarked", () => {
    expect(modelById("gemini-3.8-flash-high").sunsetOn).toBeUndefined();
    expect(modelById("claude-sonnet-5-5-high").sunsetOn).toBeUndefined();
  });
});
