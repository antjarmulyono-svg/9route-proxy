import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));

vi.mock("open-sse/services/usage/shared.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWithTimeout: mocks.fetchWithTimeout };
});

const {
  getAntigravityAvailabilityCache,
  resetAntigravityCatalogue,
  isAntigravityModelAvailable,
  isAntigravityModelRefusal,
  recordAntigravityModelNotFound,
  handleAntigravityModelRefusal,
} = await import("@/sse/services/antigravityQuota.js");

beforeEach(() => {
  vi.clearAllMocks();
  resetAntigravityCatalogue();
});

function jsonResponse(content) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const REFUSAL = "Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.";

describe("Antigravity refusal detection on a successful response", () => {
  it("reports a refusal and excludes the pair when the body carries one", async () => {
    const refused = await handleAntigravityModelRefusal(
      "paid-1",
      "claude-sonnet-4-6",
      jsonResponse(REFUSAL)
    );

    expect(refused).toBe(true);
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-4-6")).toBe(false);
  });

  it("leaves a genuine completion alone", async () => {
    const refused = await handleAntigravityModelRefusal(
      "free-1",
      "claude-sonnet-4-6",
      jsonResponse("OK")
    );

    expect(refused).toBe(false);
    expect(isAntigravityModelAvailable("free-1", "claude-sonnet-4-6")).toBe(true);
  });

  it("does not consume the caller's response body", async () => {
    const response = jsonResponse("OK");

    await handleAntigravityModelRefusal("free-1", "claude-sonnet-4-6", response);

    const parsed = await response.json();
    expect(parsed.choices[0].message.content).toBe("OK");
  });

  it("stays silent for a streaming response it cannot inspect", async () => {
    const stream = new Response("data: {}\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const refused = await handleAntigravityModelRefusal("paid-1", "claude-sonnet-4-6", stream);

    expect(refused).toBe(false);
    expect(isAntigravityModelAvailable("paid-1", "claude-sonnet-4-6")).toBe(true);
  });

  it("treats an unparsable body as a non-refusal rather than throwing", async () => {
    const broken = new Response("not json at all", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      handleAntigravityModelRefusal("paid-1", "claude-sonnet-4-6", broken)
    ).resolves.toBe(false);
  });

  it("keeps the standalone predicate and recorder consistent", () => {
    expect(isAntigravityModelRefusal(REFUSAL)).toBe(true);
    recordAntigravityModelNotFound("paid-2", "claude-opus-4-6-thinking");
    expect(isAntigravityModelAvailable("paid-2", "claude-opus-4-6-thinking")).toBe(false);
  });
});
