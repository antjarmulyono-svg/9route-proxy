import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  validateApiKey: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: mocks.validateApiKey,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const {
  resetAntigravityCatalogue,
  isAntigravityModelAvailable,
  recordAntigravityModelNotFound,
  syncAntigravityCatalogueFromDb,
} = await import("@/sse/services/antigravityQuota.js");

describe("POST /api/providers/antigravity/reset-catalogue route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAntigravityCatalogue();
  });

  it("rejects unauthorized request with 401 when neither api key nor session is present", async () => {
    const { POST } = await import("@/app/api/providers/antigravity/reset-catalogue/route.js");
    const fakeReq = { headers: new Headers(), cookies: { get: () => null } };
    const res = await POST(fakeReq);
    expect(res.status).toBe(401);
  });

  it("rejects request with 401 when api key is invalid", async () => {
    mocks.validateApiKey.mockResolvedValueOnce(false);
    const { POST } = await import("@/app/api/providers/antigravity/reset-catalogue/route.js");
    const headers = new Headers();
    headers.set("Authorization", "Bearer invalid-key");
    const fakeReq = { headers, cookies: { get: () => null } };
    const res = await POST(fakeReq);
    expect(res.status).toBe(401);
  });

  it("allows access with valid API key and resyncs catalogue", async () => {
    mocks.validateApiKey.mockResolvedValueOnce(true);
    mocks.getProviderConnections.mockResolvedValueOnce([
      { id: "conn-1", availableModelIds: ["gemini-3.8-flash-high"] },
      { id: "conn-2", availableModelIds: ["gemini-3.8-flash-medium", "claude-opus-4-6-thinking"] }
    ]);

    const { POST } = await import("@/app/api/providers/antigravity/reset-catalogue/route.js");
    const headers = new Headers();
    headers.set("Authorization", "Bearer valid-key");
    const fakeReq = { headers, cookies: { get: () => null } };
    const res = await POST(fakeReq);
    const data = await res.json();

    expect(res.status).toBe(200);
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

    recordAntigravityModelNotFound("conn-1", "claude-opus-4-6-thinking");
    expect(isAntigravityModelAvailable("conn-1", "claude-opus-4-6-thinking", conn1)).toBe(false);

    const res = syncAntigravityCatalogueFromDb([conn1, conn2]);

    expect(res.syncedAccounts).toBe(2);
    expect(res.totalModels).toBe(3);
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
