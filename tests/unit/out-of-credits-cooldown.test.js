import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

// Anthropic reports exhausted credits as a 429 rate_limit_error. Backoff is wrong
// for that case: credits do not come back on their own, so an exponential ladder
// starting at 2s makes every request pay a doomed upstream call before falling
// through to the next account. These rules must therefore win over "rate limit".
describe("out-of-credits error classification", () => {
  const LONG_COOLDOWN_MS = 2 * 60 * 1000;

  it("gives out_of_credits a long fixed cooldown, not backoff", () => {
    const result = checkFallbackError(
      429,
      '{"type":"error","error":{"type":"rate_limit_error","message":"out_of_credits"}}',
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(LONG_COOLDOWN_MS);
    expect(result.newBackoffLevel).toBeUndefined();
  });

  it("gives credits_required a long fixed cooldown, not backoff", () => {
    const result = checkFallbackError(429, "credits_required for this model");

    expect(result.cooldownMs).toBe(LONG_COOLDOWN_MS);
    expect(result.newBackoffLevel).toBeUndefined();
  });

  // The rule only helps if it is matched before the generic "rate limit" rule,
  // which real Anthropic bodies also contain.
  it("wins over the generic rate-limit rule when both texts are present", () => {
    const result = checkFallbackError(
      429,
      "rate limit exceeded: out_of_credits",
    );

    expect(result.cooldownMs).toBe(LONG_COOLDOWN_MS);
    expect(result.newBackoffLevel).toBeUndefined();
  });

  it("leaves a plain rate limit on exponential backoff", () => {
    const result = checkFallbackError(429, "rate limit exceeded", 2);

    expect(result.shouldFallback).toBe(true);
    expect(result.newBackoffLevel).toBe(3);
    expect(result.cooldownMs).toBeLessThan(LONG_COOLDOWN_MS);
  });
});
