import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const credentials = {
  projectId: "synthetic-project",
  connectionId: "synthetic-connection",
};

function requestBody(stream) {
  return {
    stream,
    stream_options: { include_usage: true },
    request: {
      contents: [{ role: "user", parts: [{ text: "Reply only OK" }] }],
    },
  };
}

// Streaming is carried by the URL (`streamGenerateContent?alt=sse`), never by the
// payload: Cloud Code Assist rejects the whole request with
// `Unknown name "stream": Cannot find field`. So neither key may reach upstream,
// while the caller's own `body` must keep `stream` — chatCore still reads it to
// decide how to consume the response.
describe("AntigravityExecutor stream_options normalization", () => {
  it("drops stream and stream_options from a non-streaming request", () => {
    const executor = new AntigravityExecutor();
    const body = requestBody(false);
    const output = executor.transformRequest(
      "gpt-oss-120b-medium",
      body,
      false,
      credentials,
    );

    expect(output.stream).toBeUndefined();
    expect(output.stream_options).toBeUndefined();
    expect(body.stream).toBe(false);
  });

  it("drops stream and stream_options from a streaming request", () => {
    const executor = new AntigravityExecutor();
    const body = requestBody(true);
    const output = executor.transformRequest(
      "gpt-oss-120b-medium",
      body,
      true,
      credentials,
    );

    expect(output.stream).toBeUndefined();
    expect(output.stream_options).toBeUndefined();
    // Caller-visible body is untouched, so the response is still consumed as SSE.
    expect(body.stream).toBe(true);
  });

  it("still wraps the Cloud Code Assist envelope", () => {
    const executor = new AntigravityExecutor();
    const output = executor.transformRequest(
      "gpt-oss-120b-medium",
      requestBody(true),
      true,
      credentials,
    );

    expect(output.project).toBe("synthetic-project");
    expect(output.model).toBe("gpt-oss-120b-medium");
    expect(output.request.contents).toHaveLength(1);
  });
});
