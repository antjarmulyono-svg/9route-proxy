function modelType(model) {
  return model?.kind || model?.type || "llm";
}

export async function runSequentialModelTests({ modelIds, testModel, onProgress = () => {} }) {
  const results = [];

  for (const modelId of modelIds) {
    onProgress({ modelId, state: "testing", error: null });

    let result;
    try {
      const response = await testModel(modelId);
      result = {
        modelId,
        ok: response?.ok === true,
        error: response?.ok === true ? null : (response?.error || "Model not reachable"),
      };
    } catch (error) {
      result = {
        modelId,
        ok: false,
        error: error instanceof Error ? error.message : "Model test failed",
      };
    }

    results.push(result);
    onProgress({
      modelId,
      state: result.ok ? "success" : "error",
      error: result.error,
    });
  }

  return results;
}

export function getProviderCustomModelRows({
  customModels = [],
  modelAliases = {},
  providerAlias,
  builtInModels = [],
  type = "llm",
  includeLegacyAliases = true,
}) {
  const builtInIds = new Set(builtInModels.map((model) => model.id));
  const seenFullModels = new Set();
  const rows = [];

  for (const model of customModels) {
    if (!model?.id || model.providerAlias !== providerAlias) continue;
    const rowType = modelType(model);
    if (type && rowType !== type) continue;
    if (builtInIds.has(model.id)) continue;

    const fullModel = `${providerAlias}/${model.id}`;
    if (seenFullModels.has(fullModel)) continue;
    seenFullModels.add(fullModel);
    rows.push({
      id: model.id,
      name: model.name || model.id,
      fullModel,
      source: "custom",
      type: rowType,
    });
  }

  if (!includeLegacyAliases) return rows;

  const prefix = `${providerAlias}/`;
  for (const [alias, fullModel] of Object.entries(modelAliases || {})) {
    if (typeof fullModel !== "string" || !fullModel.startsWith(prefix)) continue;
    const id = fullModel.slice(prefix.length);
    if (!id || builtInIds.has(id) || seenFullModels.has(fullModel)) continue;

    seenFullModels.add(fullModel);
    rows.push({
      id,
      alias,
      fullModel,
      source: "legacyAlias",
      type: type || "llm",
    });
  }

  return rows;
}
