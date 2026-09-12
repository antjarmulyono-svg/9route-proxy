import { describe, it, expect, vi } from "vitest";
import {
  detectRelayRegion,
  regionFromVercelId,
  regionFromCfRay,
  regionFromDenoServer,
} from "@/lib/network/relayRegion";

/** Minimal stand-in for a fetch Response carrying only headers. */
function headerResponse(headerMap) {
  return { headers: new Headers(headerMap) };
}

describe("regionFromVercelId", () => {
  it("maps a single-segment edge code", () => {
    expect(regionFromVercelId("sin1::abc-123")).toBe("ap-southeast");
    expect(regionFromVercelId("iad1::xyz")).toBe("us-east");
    expect(regionFromVercelId("fra1::xyz")).toBe("eu-central");
  });

  it("maps the repeated form Vercel emits on relayed calls", () => {
    // observed in the wild: "sin1::sin1::97b4z-1789111618045-2c1d316559ed"
    expect(regionFromVercelId("sin1::sin1::97b4z-1789111618045")).toBe(
      "ap-southeast"
    );
  });

  it("returns null for unknown or empty codes", () => {
    expect(regionFromVercelId("mars1::abc")).toBeNull();
    expect(regionFromVercelId("")).toBeNull();
    expect(regionFromVercelId(undefined)).toBeNull();
  });
});

describe("regionFromCfRay", () => {
  it("maps the trailing IATA colo code", () => {
    expect(regionFromCfRay("7f2a1b3c4d5e6f7g-SIN")).toBe("ap-southeast");
    expect(regionFromCfRay("7f2a1b3c4d5e6f7g-cgk")).toBe("ap-southeast");
    expect(regionFromCfRay("abc-IAD")).toBe("us-east");
    expect(regionFromCfRay("abc-GRU")).toBe("sa-east");
  });

  it("returns null when the colo is unknown or absent", () => {
    expect(regionFromCfRay("abc-ZZZ")).toBeNull();
    expect(regionFromCfRay("noseparator")).toBeNull();
    expect(regionFromCfRay("")).toBeNull();
  });
});

describe("regionFromDenoServer", () => {
  it("maps the GCP region embedded in the server header", () => {
    expect(regionFromDenoServer("deno/gcp-asia-southeast1")).toBe("ap-southeast");
    expect(regionFromDenoServer("deno/gcp-asia-northeast1")).toBe("ap-northeast");
    expect(regionFromDenoServer("deno/gcp-europe-west4")).toBe("eu-west");
    expect(regionFromDenoServer("deno/gcp-us-east4")).toBe("us-east");
  });

  it("ignores server headers from other platforms", () => {
    expect(regionFromDenoServer("Vercel")).toBeNull();
    expect(regionFromDenoServer("cloudflare")).toBeNull();
    expect(regionFromDenoServer("")).toBeNull();
  });
});

describe("detectRelayRegion", () => {
  it("detects a Vercel relay from x-vercel-id", async () => {
    const fetchImpl = vi.fn(async () =>
      headerResponse({ "x-vercel-id": "sin1::sin1::abc", server: "Vercel" })
    );
    const result = await detectRelayRegion("https://relay.vercel.app", {
      fetchImpl,
    });
    expect(result).toEqual({
      region: "ap-southeast",
      detected: true,
      edge: "sin1::sin1::abc",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("detects a Cloudflare relay from cf-ray", async () => {
    const fetchImpl = vi.fn(async () =>
      headerResponse({ "cf-ray": "9a8b7c6d5e4f3210-FRA", server: "cloudflare" })
    );
    const result = await detectRelayRegion("https://relay.workers.dev", {
      fetchImpl,
    });
    expect(result.region).toBe("eu-central");
    expect(result.detected).toBe(true);
  });

  it("detects a Deno relay from the server header", async () => {
    const fetchImpl = vi.fn(async () =>
      headerResponse({ server: "deno/gcp-asia-southeast1" })
    );
    const result = await detectRelayRegion("https://relay.deno.net", {
      fetchImpl,
    });
    expect(result.region).toBe("ap-southeast");
    expect(result.detected).toBe(true);
  });

  it("falls back to global when no header is recognisable", async () => {
    const fetchImpl = vi.fn(async () =>
      headerResponse({ server: "nginx", "x-vercel-id": "mars1::abc" })
    );
    const result = await detectRelayRegion("https://relay.example.com", {
      fetchImpl,
    });
    expect(result.region).toBe("global");
    expect(result.detected).toBe(false);
    // the raw value is still reported so an operator can see what was seen
    expect(result.edge).toBe("mars1::abc");
  });

  it("falls back to global when the probe throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await detectRelayRegion("https://down.example.com", {
      fetchImpl,
    });
    // A failed probe says nothing about the relay — the deploy already reported
    // ready, so this must not surface as an error.
    expect(result).toEqual({ region: "global", detected: false, edge: "" });
  });

  it("does not probe an empty url", async () => {
    const fetchImpl = vi.fn();
    const result = await detectRelayRegion("", { fetchImpl });
    expect(result.detected).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts the probe once the timeout budget elapses", async () => {
    const fetchImpl = vi.fn(
      (url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        })
    );
    const result = await detectRelayRegion("https://slow.example.com", {
      fetchImpl,
      timeoutMs: 10,
    });
    expect(result.region).toBe("global");
    expect(result.detected).toBe(false);
  });
});
