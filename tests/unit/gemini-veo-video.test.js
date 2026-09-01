import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 0 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));

const tokenMocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
}));

vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => tokenMocks);
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { handleVideoCreate, handleVideoGet, handleVideoContent } from "@/sse/handlers/videoGeneration.js";
import { encodeGeminiJobId, decodeGeminiJobId } from "open-sse/handlers/videoCore.js";

const originalFetch = global.fetch;

const OPERATION = "models/veo-3.1-lite-generate-preview/operations/op12345";
const JOB_ID = encodeGeminiJobId(OPERATION);
const FILE_URI = "https://generativelanguage.googleapis.com/v1beta/files/vid123:download?alt=media";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const makeRequest = (body, { headers = {} } = {}) =>
  new Request("http://localhost:20128/v1/videos/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const pollRequest = (id) =>
  new Request(`http://localhost:20128/v1/videos/${encodeURIComponent(id)}`, { method: "GET" });

const geminiAccount = (overrides = {}) => ({
  connectionId: "conn-gemini-1",
  apiKey: "AIzaSyFakeKey123",
  authType: "apikey",
  ...overrides,
});

const doneOperation = {
  name: OPERATION,
  done: true,
  response: {
    "@type": "type.googleapis.com/google.ai.generativelanguage.v1beta.GenerateVideoResponse",
    generateVideoResponse: { generatedSamples: [{ video: { uri: FILE_URI } }] },
  },
};

beforeEach(() => {
  global.fetch = vi.fn();
  authMocks.getProviderCredentials.mockReset();
  authMocks.markAccountUnavailable.mockClear();
  authMocks.clearAccountError.mockClear();
  tokenMocks.checkAndRefreshToken.mockClear();
  delete process.env.BASE_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Google Veo job ids", () => {
  it("round-trips an operation name through an id with no path separators", () => {
    expect(JOB_ID).not.toContain("/");
    expect(decodeGeminiJobId(JOB_ID)).toBe(OPERATION);
  });

  it("still accepts the legacy raw and tilde-separated forms", () => {
    expect(decodeGeminiJobId(OPERATION)).toBe(OPERATION);
    expect(decodeGeminiJobId(OPERATION.replace(/\//g, "~"))).toBe(OPERATION);
  });

  it("rejects ids that are not Veo operations", () => {
    expect(decodeGeminiJobId("vid_01jabcdef")).toBeNull();
    expect(decodeGeminiJobId(encodeGeminiJobId("../../v1beta/models"))).toBeNull();
    expect(decodeGeminiJobId("gemini_not-valid-base64!!")).toBeNull();
  });
});

describe("Google Veo video creation", () => {
  it("routes gemini/veo-* to predictLongRunning and maps the request body", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION }));

    const res = await handleVideoCreate(
      makeRequest({
        model: "gemini/veo-3.1-lite-generate-preview",
        prompt: "A drone shot of mountains",
        aspect_ratio: "16:9",
        duration: 8,
        negative_prompt: "blurry",
      }),
      "generations"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe(JOB_ID);
    expect(body.id).toBe(JOB_ID);
    expect(body.status).toBe("pending");
    expect(body.model).toBe("veo-3.1-lite-generate-preview");

    const [callUrl, callOpts] = global.fetch.mock.calls[0];
    expect(callUrl).toContain("models/veo-3.1-lite-generate-preview:predictLongRunning");
    expect(callOpts.headers["x-goog-api-key"]).toBe("AIzaSyFakeKey123");
    expect(callOpts.headers.Authorization).toBeUndefined();

    const sent = JSON.parse(callOpts.body);
    expect(sent.instances[0].prompt).toBe("A drone shot of mountains");
    expect(sent.parameters).toEqual({ aspectRatio: "16:9", durationSeconds: 8, negativePrompt: "blurry" });
  });

  it("sends no parameters the caller did not ask for", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION }));

    await handleVideoCreate(
      makeRequest({ model: "gemini/veo-3.1-lite-generate-preview", prompt: "a cat" }),
      "generations"
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.parameters).toEqual({});
  });

  it("lets an explicit parameters object reach Veo untouched", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION }));

    await handleVideoCreate(
      makeRequest({
        model: "gemini/veo-3.1-generate-preview",
        prompt: "a cat",
        aspect_ratio: "16:9",
        parameters: { aspectRatio: "9:16", futureVeoOption: true },
      }),
      "generations"
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.parameters).toEqual({ aspectRatio: "9:16", futureVeoOption: true });
  });

  it("converts a data: URL image into Veo's inline image shape", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION }));

    await handleVideoCreate(
      makeRequest({
        model: "gemini/veo-3.1-generate-preview",
        prompt: "animate this",
        image: "data:image/png;base64,AAAB",
      }),
      "generations"
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.instances[0].image).toEqual({ mimeType: "image/png", bytesBase64Encoded: "AAAB" });
  });

  it("rejects an http image URL instead of fetching it server-side", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());

    const res = await handleVideoCreate(
      makeRequest({
        model: "gemini/veo-3.1-generate-preview",
        prompt: "animate this",
        image: "https://example.com/cat.png",
      }),
      "generations"
    );

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt before spending a billable job", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());

    const res = await handleVideoCreate(
      makeRequest({ model: "gemini/veo-3.1-generate-preview" }),
      "generations"
    );

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    // A malformed body says nothing about the account's health.
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("routes a bare veo-* model id to gemini", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION }));

    const res = await handleVideoCreate(
      makeRequest({ model: "veo-3.1-fast-generate-preview", prompt: "a cat" }),
      "generations"
    );

    expect(res.status).toBe(200);
    expect(authMocks.getProviderCredentials).toHaveBeenCalledWith(
      "gemini", expect.anything(), "veo-3.1-fast-generate-preview", expect.anything()
    );
  });
});

describe("Google Veo job polling", () => {
  it("reports an unfinished operation as in_progress", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION, done: false }));

    const res = await handleVideoGet(pollRequest(JOB_ID), JOB_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("in_progress");
    expect(body.request_id).toBe(JOB_ID);
    expect(global.fetch.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/${OPERATION}`);
  });

  it("returns a gateway download URL that does not carry the API key", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse(doneOperation));

    const res = await handleVideoGet(pollRequest(JOB_ID), JOB_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.video.url).toBe(`http://localhost:20128/v1/videos/${encodeURIComponent(JOB_ID)}/content`);
    expect(JSON.stringify(body)).not.toContain("AIzaSyFakeKey123");
  });

  it("surfaces a safety-filtered result as a failure", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        name: OPERATION,
        done: true,
        response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["blocked by policy"] } },
      })
    );

    const res = await handleVideoGet(pollRequest(JOB_ID), JOB_ID);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error.message).toContain("blocked by policy");
  });

  it("rejects a malformed Veo job id without calling upstream", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());

    const res = await handleVideoGet(
      new Request("http://localhost:20128/v1/videos/x", { method: "GET", headers: { "x-provider": "gemini" } }),
      "not-an-operation"
    );

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});

describe("Google Veo video download", () => {
  const contentRequest = (id) =>
    new Request(`http://localhost:20128/v1/videos/${encodeURIComponent(id)}/content`, { method: "GET" });

  it("streams the file with the API key attached server-side", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch
      .mockResolvedValueOnce(jsonResponse(doneOperation))
      .mockResolvedValueOnce(
        new Response("fake-mp4-bytes", { status: 200, headers: { "Content-Type": "video/mp4" } })
      );

    const res = await handleVideoContent(contentRequest(JOB_ID), JOB_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(await res.text()).toBe("fake-mp4-bytes");

    const [downloadUrl, downloadOpts] = global.fetch.mock.calls[1];
    expect(String(downloadUrl)).toBe(FILE_URI);
    expect(downloadOpts.headers["x-goog-api-key"]).toBe("AIzaSyFakeKey123");
  });

  it("refuses to send the key to a host other than Google", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        name: OPERATION,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://evil.example.com/video.mp4" } }] } },
      })
    );

    const res = await handleVideoContent(contentRequest(JOB_ID), JOB_ID);

    expect(res.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("404s while the job is still running", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(geminiAccount());
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION, done: false }));

    const res = await handleVideoContent(contentRequest(JOB_ID), JOB_ID);

    expect(res.status).toBe(404);
  });

  it("does not serve non-Veo job ids", async () => {
    const res = await handleVideoContent(contentRequest("vid_01jabcdef"), "vid_01jabcdef");

    expect(res.status).toBe(404);
    expect(authMocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});
