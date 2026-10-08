import { describe, expect, it } from "vitest";

const {
  BOZ_GEMINI_PROFILE_ID,
  shouldInjectGeminiPromptProfile,
  applyGeminiPromptProfile,
  prepareGeminiPromptProfile,
} = await import("@/sse/services/geminiPromptProfile.js");

function openAiBody() {
  return {
    messages: [
      { role: "system", content: "Caller system instruction" },
      { role: "user", content: "Build the feature" },
    ],
  };
}

describe("Gemini 3.8 prompt profile routing", () => {
  it.each([
    "gemini-3.8-flash",
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.8-flash-tiered",
  ])("matches Antigravity %s", (model) => {
    expect(shouldInjectGeminiPromptProfile("antigravity", model, true)).toBe(true);
  });

  it.each([
    ["antigravity", "gemini-3.7-flash-high"],
    ["antigravity", "claude-sonnet-5-5-high"],
    ["gemini-cli", "gemini-3.8-flash-high"],
    ["openai", "gemini-3.8-flash-high"],
  ])("does not match %s/%s", (provider, model) => {
    expect(shouldInjectGeminiPromptProfile(provider, model, true)).toBe(false);
  });

  it("stays disabled when the runtime setting is false", () => {
    expect(shouldInjectGeminiPromptProfile("antigravity", "gemini-3.8-flash-high", false)).toBe(false);
  });

  it("prepares a matching request from runtime settings in one call", () => {
    const body = openAiBody();
    const applied = prepareGeminiPromptProfile({
      body,
      sourceFormat: "openai",
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      settings: { geminiPromptProfileEnabled: true },
    });

    expect(applied).toBe(true);
    expect(body.messages[0].content).toContain(BOZ_GEMINI_PROFILE_ID);
  });

  it("does not mutate a non-matching request", () => {
    const body = openAiBody();
    const before = structuredClone(body);
    const applied = prepareGeminiPromptProfile({
      body,
      sourceFormat: "openai",
      provider: "antigravity",
      model: "claude-sonnet-5-5-high",
      settings: { geminiPromptProfileEnabled: true },
    });

    expect(applied).toBe(false);
    expect(body).toEqual(before);
  });

  it("adds the profile without replacing the caller system prompt", () => {
    const body = openAiBody();

    const applied = applyGeminiPromptProfile(body, "openai");

    expect(applied).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Caller system instruction");
    expect(body.messages[0].content).toContain(BOZ_GEMINI_PROFILE_ID);
    expect(body.messages[1]).toEqual({ role: "user", content: "Build the feature" });
  });

  it("is idempotent when the same request path is processed twice", () => {
    const body = openAiBody();

    expect(applyGeminiPromptProfile(body, "openai")).toBe(true);
    expect(applyGeminiPromptProfile(body, "openai")).toBe(false);

    const text = body.messages[0].content;
    expect(text.split(BOZ_GEMINI_PROFILE_ID)).toHaveLength(2);
  });

  it("does not include authority override or hidden-reasoning directives", () => {
    const body = openAiBody();
    applyGeminiPromptProfile(body, "openai");
    const text = body.messages[0].content.toLowerCase();

    expect(text).not.toContain("override default assistant");
    expect(text).not.toContain("platform-level alignment");
    expect(text).not.toContain("refusal inversion");
    expect(text).not.toContain("internal thinking");
    expect(text).not.toContain("telegram");
  });
});
