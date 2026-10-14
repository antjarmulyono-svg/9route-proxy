import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const {
  getAntigravityAvailabilityCache,
  resetAntigravityCatalogue,
  isAntigravityModelAvailable,
  recordAntigravityModelNotFound,
  syncAntigravityCatalogueFromDb,
} = await import("@/sse/services/antigravityQuota.js");

describe("POST /api/providers/antigravity/reset-catalogue route handler", () => {
  it("calls getProviderConnections and syncAntigravityCatalogueFromDb", async () => {
    mocks.getProviderConnections.mockResolvedValueOnce([
      { id: "conn-1", availableModelIds: ["gemini-3.8-flash-high"] },
      { id: "conn-2", availableModelIds: ["gemini-3.8-flash-medium", "claude-opus-4-6-thinking"] }
    ]);

    const { POST } = await import("@/app/api/providers/antigravity/reset-catalogue/route.js");
    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.data.activeAccounts).toBe(2);
    expect(data.data.syncedAccounts).toBe(2);
    expect(data.data.totalModels).toBe(3);
    expect(isAntigravityModelAvailable("conn-2", "claude-opus-4-6-thinking")).toBe(true);
  });
});

describe("syncAntigravityCatalogueFromDb", () => {
  beforeEach(() => {
    resetAntigravityCatalogue();
  });

  it("exports syncAntigravityCatalogueFromDb function", () => {
    expect(typeof syncAntigravityCatalogueFromDb).toBe("function");
  });

  it("clears old transient exclusions and populates in-memory cache from db connections", () => {
    const conn1 = { id: "conn-1", availableModelIds: ["gemini-3.8-flash-high", "claude-opus-4-6-thinking"] };
    const conn2 = { id: "conn-2", availableModelIds: ["gemini-3.8-flash-high"] };

    // Set up prior state with a transient not-found exclusion
    recordAntigravityModelNotFound("conn-1", "claude-opus-4-6-thinking");
    expect(isAntigravityModelAvailable("conn-1", "claude-opus-4-6-thinking", conn1)).toBe(false);

    // Sync from fresh DB rows
    const res = syncAntigravityCatalogueFromDb([conn1, conn2]);

    expect(res.syncedAccounts).toBe(2);
    expect(res.totalModels).toBe(3);

    // Exclusion was cleared, model is available again
    expect(isAntigravityModelAvailable("conn-1", "claude-opus-4-6-thinking")).toBe(true);
    expect(isAntigravityModelAvailable("conn-2", "claude-opus-4-6-thinking")).toBe(false);
    expect(isAntigravityModelAvailable("conn-2", "gemini-3.8-flash-high")).toBe(true);
  });

  it("handles empty or invalid connections array safely", () => {
    expect(syncAntigravityCatalogueFromDb([])).toEqual({ syncedAccounts: 0, totalModels: 0 });
    expect(syncAntigravityCatalogueFromDb(null)).toEqual({ syncedAccounts: 0, totalModels: 0 });
    expect(syncAntigravityCatalogueFromDb([{ id: "conn-empty" }])).toEqual({ syncedAccounts: 0, totalModels: 0 });
  });
});
