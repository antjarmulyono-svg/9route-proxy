import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combos-caps-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createCombo } = await import("@/lib/db/repos/combosRepo.js");
  const { buildModelsList } = await import("@/app/api/v1/models/route.js");

  return {
    createCombo,
    buildModelsList,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("Combo capabilities and token limits in /v1/models", () => {
  let cleanup = () => {};

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("exposes context_length, max_completion_tokens, and capabilities for combo models", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createCombo({
      name: "Test-Fast-Agent-Combo",
      kind: "llm",
      models: [
        "ag/gemini-3.8-flash-high",
        "ag/gemini-3.7-flash-high",
        "cc/claude-sonnet-5",
      ],
    });

    const models = await ctx.buildModelsList(["llm"]);
    const combo = models.find((m) => m.id === "Test-Fast-Agent-Combo");

    expect(combo).toBeDefined();
    expect(combo.owned_by).toBe("combo");
    expect(combo.context_length).toBe(1048576);
    expect(combo.max_completion_tokens).toBe(65536);
    expect(combo.capabilities).toBeDefined();
    expect(combo.capabilities.contextWindow).toBe(1048576);
    expect(combo.capabilities.vision).toBe(true);
    expect(combo.capabilities.tools).toBe(true);
  });
});
