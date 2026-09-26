import { describe, expect, it } from "vitest";
import {
  getProviderCustomModelRows,
  runSequentialModelTests,
} from "@/shared/utils/providerCustomModels.js";

describe("provider custom model rows", () => {
  it("keeps identical model IDs separate per provider", () => {
    const customModels = [
      { providerAlias: "ollama", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
      { providerAlias: "opencode-go", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
    ];

    expect(getProviderCustomModelRows({ customModels, providerAlias: "ollama" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "ollama/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
    expect(getProviderCustomModelRows({ customModels, providerAlias: "opencode-go" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "opencode-go/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
  });

  it("keeps legacy alias-backed models visible without duplicating custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "custom-a", type: "llm", name: "Custom A" },
      ],
      modelAliases: {
        "custom-a": "ollama/custom-a",
        "legacy-b": "ollama/legacy-b",
        "other-provider": "opencode-go/legacy-b",
      },
      providerAlias: "ollama",
    });

    expect(rows).toEqual([
      {
        id: "custom-a",
        name: "Custom A",
        fullModel: "ollama/custom-a",
        source: "custom",
        type: "llm",
      },
      {
        id: "legacy-b",
        alias: "legacy-b",
        fullModel: "ollama/legacy-b",
        source: "legacyAlias",
        type: "llm",
      },
    ]);
  });

  it("filters built-in models and typed custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "llama3", type: "llm", name: "Llama 3" },
        { providerAlias: "ollama", id: "custom-image", type: "image", name: "Custom Image" },
        { providerAlias: "ollama", id: "custom-llm", type: "llm", name: "Custom LLM" },
      ],
      providerAlias: "ollama",
      builtInModels: [{ id: "llama3" }],
      type: "llm",
    });

    expect(rows).toEqual([
      {
        id: "custom-llm",
        name: "Custom LLM",
        fullModel: "ollama/custom-llm",
        source: "custom",
        type: "llm",
      },
    ]);
  });

  it("tests models sequentially and reports progress in order", async () => {
    const activeRequests = { count: 0, max: 0 };
    const tested = [];
    const progress = [];

    const results = await runSequentialModelTests({
      modelIds: ["model-a", "model-b", "model-c"],
      testModel: async (modelId) => {
        activeRequests.count += 1;
        activeRequests.max = Math.max(activeRequests.max, activeRequests.count);
        tested.push(modelId);
        await Promise.resolve();
        activeRequests.count -= 1;
        return modelId === "model-b"
          ? { ok: false, error: "Unavailable" }
          : { ok: true };
      },
      onProgress: (entry) => progress.push(entry),
    });

    expect(activeRequests.max).toBe(1);
    expect(tested).toEqual(["model-a", "model-b", "model-c"]);
    expect(results).toEqual([
      { modelId: "model-a", ok: true, error: null },
      { modelId: "model-b", ok: false, error: "Unavailable" },
      { modelId: "model-c", ok: true, error: null },
    ]);
    expect(progress.map((entry) => `${entry.modelId}:${entry.state}`)).toEqual([
      "model-a:testing",
      "model-a:success",
      "model-b:testing",
      "model-b:error",
      "model-c:testing",
      "model-c:success",
    ]);
  });

  it("continues sequential tests after request errors", async () => {
    const tested = [];

    const results = await runSequentialModelTests({
      modelIds: ["model-a", "model-b"],
      testModel: async (modelId) => {
        tested.push(modelId);
        if (modelId === "model-a") throw new Error("Network error");
        return { ok: true };
      },
    });

    expect(tested).toEqual(["model-a", "model-b"]);
    expect(results).toEqual([
      { modelId: "model-a", ok: false, error: "Network error" },
      { modelId: "model-b", ok: true, error: null },
    ]);
  });
});
