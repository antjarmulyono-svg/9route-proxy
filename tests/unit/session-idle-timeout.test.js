import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDashboardAuthToken,
  verifyDashboardAuthToken,
  verifyDashboardAuthSession,
  refreshDashboardAuthToken,
} from "../../src/lib/auth/dashboardSession.js";

describe("Dashboard Session Idle Timeout", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps lastActive in claims upon token creation", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken({ user: "admin" });
    const result = await verifyDashboardAuthSession(token);

    expect(result.valid).toBe(true);
    expect(result.payload.authenticated).toBe(true);
    expect(result.payload.lastActive).toBe(Math.floor(nowMs / 1000));
  });

  it("considers token valid when within maxIdleSeconds", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken();

    // 10 minutes later (max idle is 30 minutes = 1800s)
    vi.setSystemTime(new Date(nowMs + 10 * 60 * 1000));
    const result = await verifyDashboardAuthSession(token, { maxIdleSeconds: 1800 });

    expect(result.valid).toBe(true);
    expect(await verifyDashboardAuthToken(token, { maxIdleSeconds: 1800 })).toBe(true);
  });

  it("marks token invalid with reason idle when idle time exceeds maxIdleSeconds", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken();

    // 31 minutes later (max idle is 30 minutes = 1800s)
    vi.setSystemTime(new Date(nowMs + 31 * 60 * 1000));
    const result = await verifyDashboardAuthSession(token, { maxIdleSeconds: 1800 });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("idle");
    expect(await verifyDashboardAuthToken(token, { maxIdleSeconds: 1800 })).toBe(false);
  });

  it("ignores idle check when maxIdleSeconds is 0 (disabled)", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken();

    // 5 hours later
    vi.setSystemTime(new Date(nowMs + 5 * 3600 * 1000));
    const result = await verifyDashboardAuthSession(token, { maxIdleSeconds: 0 });

    expect(result.valid).toBe(true);
    expect(await verifyDashboardAuthToken(token, { maxIdleSeconds: 0 })).toBe(true);
  });

  it("refreshes lastActive timestamp without losing original claims", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken({ oidcEmail: "user@example.com", customClaim: "yes" });

    // 15 minutes later, refresh
    const laterMs = nowMs + 15 * 60 * 1000;
    vi.setSystemTime(new Date(laterMs));

    const refreshed = await refreshDashboardAuthToken(token);
    expect(refreshed).toBeTruthy();

    const result = await verifyDashboardAuthSession(refreshed, { maxIdleSeconds: 1800 });
    expect(result.valid).toBe(true);
    expect(result.payload.lastActive).toBe(Math.floor(laterMs / 1000));
    expect(result.payload.oidcEmail).toBe("user@example.com");
    expect(result.payload.customClaim).toBe("yes");
  });
});

describe("Dashboard Guard Inactivity Redirection", () => {
  it("redirects to /login?reason=idle when session is idle expired", async () => {
    const nowMs = 1700000000000;
    vi.setSystemTime(new Date(nowMs));

    const token = await createDashboardAuthToken();

    // 45 minutes later
    vi.setSystemTime(new Date(nowMs + 45 * 60 * 1000));

    const sessionResult = await verifyDashboardAuthSession(token, { maxIdleSeconds: 1800 });
    expect(sessionResult.valid).toBe(false);
    expect(sessionResult.reason).toBe("idle");
  });
});
