import { describe, it, expect, beforeEach } from "vitest";
import { upsertClient, getClientByIp, toggleClient, deleteClient, getAllClients } from "@/lib/db/repos/clientsRepo.js";
import { isClientIpAllowed, trackIncomingRequest, detectToolFromRequest } from "@/lib/clients/clientTracker.js";
import { isClientEnabled } from "@/mitm/dbReader.js";

describe("Client Connections Monitoring & On/Off Control", () => {
  const TEST_IP = "10.10.123.147";

  beforeEach(async () => {
    await deleteClient(TEST_IP);
  });

  it("should register a client and enable it by default", async () => {
    const client = await upsertClient({
      ip: TEST_IP,
      name: "Antigravity Dev Station",
      tool: "Antigravity IDE",
      category: "mitm",
      enabled: true,
    });

    expect(client).toBeDefined();
    expect(client.ip).toBe(TEST_IP);
    expect(client.enabled).toBe(true);
    expect(client.name).toBe("Antigravity Dev Station");

    const fetched = await getClientByIp(TEST_IP);
    expect(fetched).not.toBeNull();
    expect(fetched.ip).toBe(TEST_IP);
    expect(fetched.enabled).toBe(true);

    // MITM dbReader check
    expect(isClientEnabled(TEST_IP)).toBe(true);
    // Gateway check
    expect(isClientIpAllowed(TEST_IP)).toBe(true);
  });

  it("should toggle client to OFF and reflect in MITM & Gateway checks", async () => {
    await upsertClient({
      ip: TEST_IP,
      name: "Antigravity Dev Station",
      enabled: true,
    });

    // Toggle to OFF
    const toggledOff = await toggleClient(TEST_IP, false);
    expect(toggledOff.enabled).toBe(false);

    // MITM process must see false (triggers passthrough to Google default)
    expect(isClientEnabled(TEST_IP)).toBe(false);
    // Gateway must see false (triggers 403 Forbidden)
    expect(isClientIpAllowed(TEST_IP)).toBe(false);

    // Toggle back to ON
    const toggledOn = await toggleClient(TEST_IP, true);
    expect(toggledOn.enabled).toBe(true);
    expect(isClientEnabled(TEST_IP)).toBe(true);
    expect(isClientIpAllowed(TEST_IP)).toBe(true);
  });

  it("should correctly detect tools from request headers", () => {
    // Claude Code
    const claudeReq = {
      headers: { "user-agent": "claude-code/0.2.19 (linux x64)" },
      url: "/v1/chat/completions",
    };
    expect(detectToolFromRequest(claudeReq).tool).toBe("Claude Code");

    // Cline
    const clineReq = {
      headers: { "user-agent": "cline/3.2.1" },
      url: "/v1/chat/completions",
    };
    expect(detectToolFromRequest(clineReq).tool).toBe("Cline");

    // Antigravity (body)
    const agReq = { headers: {} };
    expect(detectToolFromRequest(agReq, { userAgent: "antigravity" }).tool).toBe("Antigravity IDE");

    // OpenCode
    const openCodeReq = {
      headers: { "user-agent": "OpenCode/1.0" },
      url: "/v1/chat/completions",
    };
    expect(detectToolFromRequest(openCodeReq).tool).toBe("OpenCode");

    // Droid
    const droidReq = {
      headers: { "user-agent": "droid-cli/1.0" },
      url: "/v1/chat/completions",
    };
    expect(detectToolFromRequest(droidReq).tool).toBe("Droid");
  });

  it("should extract and normalize client IPs including IPv6-mapped IPv4", async () => {
    const { normalizeIp, extractClientIp } = await import("@/lib/clients/clientTracker.js");

    expect(normalizeIp("::ffff:10.10.123.147")).toBe("10.10.123.147");
    expect(normalizeIp("10.10.123.147")).toBe("10.10.123.147");
    expect(normalizeIp("::1")).toBe("127.0.0.1");

    const reqWithRealIp = {
      headers: {
        get: (h) => (h === "x-9r-real-ip" ? "::ffff:10.10.123.147" : null),
      },
    };
    expect(extractClientIp(reqWithRealIp)).toBe("10.10.123.147");
  });
});

