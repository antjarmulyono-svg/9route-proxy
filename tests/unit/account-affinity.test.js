import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAccountAffinity,
  getPinnedConnectionId,
  pinConnectionId,
  unpinConnectionId,
} from "../../src/sse/services/accountAffinity.js";

const TTL_MS = 6 * 60 * 60 * 1000;

describe("accountAffinity", () => {
  beforeEach(() => {
    clearAccountAffinity();
    vi.useRealTimers();
  });

  it("returns null for a conversation that has never been pinned", () => {
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBeNull();
  });

  it("returns the pinned connection for the same provider and session", () => {
    pinConnectionId("antigravity", "sess-1", "conn-a");
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBe("conn-a");
  });

  it("keys pins per provider, so the same session id does not leak across providers", () => {
    pinConnectionId("antigravity", "sess-1", "conn-a");
    expect(getPinnedConnectionId("gemini-cli", "sess-1")).toBeNull();
  });

  // A null sessionKey means the client never identified its conversation; pinning
  // then would funnel every unattributed request onto one account.
  it("never pins when the session key is missing", () => {
    pinConnectionId("antigravity", null, "conn-a");
    expect(getPinnedConnectionId("antigravity", null)).toBeNull();
  });

  it("ignores a pin with no connection id", () => {
    pinConnectionId("antigravity", "sess-1", null);
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBeNull();
  });

  it("re-pins to whichever account served the latest turn", () => {
    pinConnectionId("antigravity", "sess-1", "conn-a");
    pinConnectionId("antigravity", "sess-1", "conn-b");
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBe("conn-b");
  });

  it("drops a pin on unpin", () => {
    pinConnectionId("antigravity", "sess-1", "conn-a");
    unpinConnectionId("antigravity", "sess-1");
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBeNull();
  });

  it("expires a pin older than the TTL", () => {
    vi.useFakeTimers();
    pinConnectionId("antigravity", "sess-1", "conn-a");
    vi.advanceTimersByTime(TTL_MS + 1000);
    expect(getPinnedConnectionId("antigravity", "sess-1")).toBeNull();
  });

  it("refreshes the TTL on every read, so an active conversation never expires", () => {
    vi.useFakeTimers();
    pinConnectionId("antigravity", "sess-1", "conn-a");

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(TTL_MS - 1000);
      expect(getPinnedConnectionId("antigravity", "sess-1")).toBe("conn-a");
    }
  });

  it("evicts the oldest entries past the cap instead of growing without bound", () => {
    const total = 2100; // MAX_ENTRIES is 2000
    for (let i = 0; i < total; i++) {
      pinConnectionId("antigravity", `sess-${i}`, `conn-${i}`);
    }

    expect(getPinnedConnectionId("antigravity", "sess-0")).toBeNull();
    expect(getPinnedConnectionId("antigravity", `sess-${total - 1}`)).toBe(
      `conn-${total - 1}`,
    );
  });
});
