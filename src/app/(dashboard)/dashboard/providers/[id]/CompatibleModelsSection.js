"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, ConfirmModal } from "@/shared/components";
import {
  getProviderCustomModelRows,
  runSequentialModelTests,
} from "@/shared/utils/providerCustomModels";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, testError, isTesting, bulkActionRunning }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium" title={modelId}>{modelId}</p>
        <div className="mt-1 flex min-w-0 items-center gap-1">
          <code className="min-w-0 truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted" title={fullModel}>{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={bulkActionRunning}
                aria-label={`Test ${modelId}`}
                title={isTesting ? "Testing model" : "Test model"}
                className="min-h-11 min-w-11 rounded text-text-muted transition-colors hover:bg-sidebar hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:p-0.5"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
        {testError && (
          <p className="mt-1 break-words text-xs text-red-500" role="status">{testError}</p>
        )}
      </div>
      <button
        onClick={onDeleteAlias}
        disabled={bulkActionRunning}
        aria-label={`Remove ${modelId}`}
        className="min-h-11 min-w-11 rounded text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:p-1"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelTestErrors, setModelTestErrors] = useState({});
  const [testingAll, setTestingAll] = useState(false);
  const [testSummary, setTestSummary] = useState(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const requestModelTest = async (modelId) => {
    const res = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
    });
    const data = await res.json();
    return {
      ok: res.ok && data.ok === true,
      error: data.error || (!res.ok ? `HTTP ${res.status}` : null),
    };
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId || testingAll) return;
    setTestingModelId(modelId);
    setModelTestErrors((prev) => ({ ...prev, [modelId]: null }));
    try {
      const result = await requestModelTest(modelId);
      setModelTestResults((prev) => ({ ...prev, [modelId]: result.ok ? "ok" : "error" }));
      setModelTestErrors((prev) => ({ ...prev, [modelId]: result.error }));
    } catch (error) {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelTestErrors((prev) => ({ ...prev, [modelId]: error.message || "Network error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleTestAll = async () => {
    if (testingAll || testingModelId || allModels.length === 0) return;

    setTestingAll(true);
    setTestSummary({ total: allModels.length, completed: 0, passed: 0, failed: 0 });
    setModelTestResults({});
    setModelTestErrors({});

    const results = await runSequentialModelTests({
      modelIds: allModels.map((model) => model.id),
      testModel: requestModelTest,
      onProgress: ({ modelId, state, error }) => {
        if (state === "testing") {
          setTestingModelId(modelId);
          return;
        }

        setModelTestResults((prev) => ({
          ...prev,
          [modelId]: state === "success" ? "ok" : "error",
        }));
        setModelTestErrors((prev) => ({ ...prev, [modelId]: error }));
        setTestSummary((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          passed: prev.passed + (state === "success" ? 1 : 0),
          failed: prev.failed + (state === "error" ? 1 : 0),
        }));
      },
    });

    setTestingModelId(null);
    setTestingAll(false);
    return results;
  };

  const deleteModel = async (model) => {
    if (model.source === "custom") {
      await onDeleteCustomModel(model.id);
      return;
    }
    await onDeleteAlias(model.alias);
  };

  const handleDeleteOne = async (model) => {
    try {
      await deleteModel(model);
    } catch (error) {
      alert(error.message || "Model could not be deleted.");
    }
  };

  const handleDeleteAll = async () => {
    if (deletingAll || allModels.length === 0) return;

    setDeletingAll(true);
    let failed = 0;
    for (const model of allModels) {
      try {
        await deleteModel(model);
      } catch (error) {
        console.log("Error deleting model:", error);
        failed += 1;
      }
    }

    setDeletingAll(false);
    setShowDeleteAllConfirm(false);
    setModelTestResults({});
    setModelTestErrors({});
    setTestSummary(null);
    if (failed > 0) alert(`${failed} model(s) could not be deleted.`);
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"
                variant="secondary"
                icon={testingAll ? "progress_activity" : "science"}
                onClick={handleTestAll}
                disabled={!canImport || testingAll || deletingAll}
              >
                {testingAll ? `Testing ${testSummary?.completed || 0}/${allModels.length}` : "Test All"}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="delete_sweep"
                onClick={() => setShowDeleteAllConfirm(true)}
                disabled={testingAll || deletingAll}
              >
                Delete All
              </Button>
            </div>
            {testSummary && (
              <p className="text-xs text-text-muted" role="status" aria-live="polite">
                Tested {testSummary.completed}/{testSummary.total}. Passed {testSummary.passed}. Failed {testSummary.failed}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {allModels.map((model) => (
              <CompatibleModelRow
                key={`${model.source}-${providerStorageAlias}/${model.id}`}
                modelId={model.id}
                fullModel={`${providerDisplayAlias}/${model.id}`}
                copied={copied}
                onCopy={onCopy}
                onDeleteAlias={() => handleDeleteOne(model)}
                onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
                testStatus={modelTestResults[model.id]}
                testError={modelTestErrors[model.id]}
                isTesting={testingModelId === model.id}
                bulkActionRunning={testingAll || deletingAll || testingModelId !== null}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-text-muted">
          No models configured. Add a model ID or import from /models.
        </p>
      )}

      <ConfirmModal
        isOpen={showDeleteAllConfirm}
        onClose={() => !deletingAll && setShowDeleteAllConfirm(false)}
        onConfirm={handleDeleteAll}
        title="Delete all models"
        message={`Delete all ${allModels.length} model(s) from ${providerDisplayAlias}? This cannot be undone.`}
        confirmText="Delete All"
        variant="danger"
        loading={deletingAll}
      />
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
