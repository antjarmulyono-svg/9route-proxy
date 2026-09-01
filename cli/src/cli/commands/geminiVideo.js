/**
 * `9router gemini video` — generate a Google Veo video through the local
 * 9router gateway and save the result as an MP4 file.
 *
 * Flow: POST /v1/videos/generations (model: gemini/veo-3.1-lite-generate-preview)
 * → poll GET /v1/videos/{request_id} until done/failed/timeout → download video.url → atomic rename.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MODEL = "gemini/veo-3.1-lite-generate-preview";
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_POLL_INTERVAL_MS = 5000;

const TERMINAL_STATUSES = new Set(["done", "failed", "completed", "error", "expired", "cancelled"]);
const FAILED_STATUSES = new Set(["failed", "error", "expired", "cancelled"]);

const HELP = `
Usage: 9router gemini video --prompt "..." [options]

Generate a Google Veo video via your local 9router gateway
(requires a connected Gemini API key).

Options:
  --prompt <text>         Video description (required)
  --output <file>         Output MP4 path (default: video.mp4)
  --model <id>            Model (default: ${DEFAULT_MODEL})
                          Available: veo-3.1-generate-preview, veo-3.1-fast-generate-preview,
                                     veo-3.1-lite-generate-preview, veo-2.0-generate-001
  --duration <seconds>    Clip length (model-dependent, e.g. 4/6/8 on Veo 3.1)
  --aspect-ratio <ratio>  e.g. 16:9, 9:16
  --resolution <res>      e.g. 720p, 1080p
  --person-generation     Passed to Veo as-is (see Google's Veo docs for values)
  --negative-prompt       Negative prompt description
  --seed <n>              Seed for reproducible output
  --image <path>          Local image for image-to-video (encoded before sending)
  --timeout <seconds>     Max wait for the job (default: ${DEFAULT_TIMEOUT_SEC})
  --port <port>           Gateway port (default: ${DEFAULT_PORT})
  --host <host>           Gateway host (default: ${DEFAULT_HOST})
  --api-key <key>         9router API key (or env NINE_ROUTER_API_KEY)
  -h, --help              Show this help
`;

function sanitizeText(text) {
  return String(text ?? "").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
}

function parseArgs(argv) {
  const opts = {
    model: DEFAULT_MODEL,
    output: "video.mp4",
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    apiKey: process.env.NINE_ROUTER_API_KEY || null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--prompt") opts.prompt = next();
    else if (a === "--output" || a === "-o") opts.output = next();
    else if (a === "--model") opts.model = next();
    else if (a === "--duration") opts.duration = parseInt(next(), 10);
    else if (a === "--aspect-ratio") opts.aspectRatio = next();
    else if (a === "--resolution") opts.resolution = next();
    else if (a === "--person-generation") opts.personGeneration = next();
    else if (a === "--negative-prompt") opts.negativePrompt = next();
    else if (a === "--seed") opts.seed = parseInt(next(), 10);
    else if (a === "--image") opts.image = next();
    else if (a === "--timeout") opts.timeoutSec = parseInt(next(), 10) || DEFAULT_TIMEOUT_SEC;
    else if (a === "--port" || a === "-p") opts.port = parseInt(next(), 10) || DEFAULT_PORT;
    else if (a === "--host" || a === "-H") opts.host = next() || DEFAULT_HOST;
    else if (a === "--api-key") opts.apiKey = next();
    else if (a === "--poll-interval-ms") opts.pollIntervalMs = parseInt(next(), 10) || DEFAULT_POLL_INTERVAL_MS;
    else if (a === "-h" || a === "--help") opts.help = true;
    else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return opts;
}

/** Local file path → base64 data URL; URLs pass through untouched. */
function imageInputToUrl(input) {
  if (/^(https?:|data:)/i.test(input)) return input;
  const buf = fs.readFileSync(input);
  const ext = path.extname(input).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Minimal JSON request against the local gateway. Returns { status, headers, body }. */
function gatewayRequest({ host, port, apiKey, method, reqPath, body, signal }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Accept: "application/json" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const req = http.request({ hostname: host, port, path: reqPath, method, headers, signal }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });

/**
 * Poll GET /v1/videos/{id} until a terminal status or deadline.
 */
async function pollUntilDone({ host, port, apiKey, requestId, connectionId, timeoutSec, pollIntervalMs, signal, onProgress }) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (true) {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutSec}s waiting for video job ${requestId}`);
    }

    const res = await gatewayRequestWithConnection({ host, port, apiKey, requestId, connectionId, signal });
    if (res.status === 200 && res.body) {
      const status = String(res.body.status || "").toLowerCase();
      onProgress?.(status || "pending", res.body.progress);
      if (FAILED_STATUSES.has(status)) {
        const msg = res.body.error?.message || res.body.error || "video generation failed";
        throw new Error(`Job ${requestId} failed: ${sanitizeText(typeof msg === "string" ? msg : JSON.stringify(msg))}`);
      }
      if (TERMINAL_STATUSES.has(status)) return res.body;
    } else if (res.status >= 400 && res.status !== 429 && res.status !== 503) {
      throw new Error(`Polling failed (HTTP ${res.status}): ${sanitizeText(res.raw?.slice(0, 300))}`);
    }
    await sleep(pollIntervalMs, signal);
  }
}

function gatewayRequestWithConnection({ host, port, apiKey, requestId, connectionId, signal }) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json", "x-provider": "gemini" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (connectionId) headers["x-connection-id"] = connectionId;
    const req = http.request(
      { hostname: host, port, path: `/v1/videos/${encodeURIComponent(requestId)}`, method: "GET", headers, signal },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Download a URL to `outputPath` via a `.part` temp file with atomic rename.
 * Veo videos are served by the gateway (the Gemini key stays server-side), so
 * the gateway's own auth headers travel with the request.
 */
async function downloadToFile(url, outputPath, { signal, headers = {} } = {}) {
  const partPath = `${outputPath}.part`;
  await new Promise((resolve, reject) => {
    const cleanupAnd = (fn) => (err) => {
      try { fs.unlinkSync(partPath); } catch { /* not created yet */ }
      fn(err);
    };
    const get = (target, redirectsLeft) => {
      const mod = target.startsWith("https:") ? https : http;
      const req = mod.get(target, { signal, headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return get(new URL(res.headers.location, target).toString(), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanupAnd(reject)(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const out = fs.createWriteStream(partPath);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", cleanupAnd(reject));
        res.on("error", cleanupAnd(reject));
      });
      req.on("error", cleanupAnd(reject));
    };
    get(url, 5);
  });
  fs.renameSync(partPath, outputPath);
}

async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.log(HELP);
    return 1;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!opts.prompt) {
    console.error("❌ --prompt is required");
    console.log(HELP);
    return 1;
  }

  const controller = new AbortController();
  const partPath = `${opts.output}.part`;
  const onSigint = () => {
    controller.abort();
    try { fs.unlinkSync(partPath); } catch { /* absent */ }
    console.error("\n✋ Cancelled");
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    const model = opts.model.startsWith("gemini/") ? opts.model : `gemini/${opts.model}`;
    const body = { model, prompt: opts.prompt };
    if (opts.duration) body.duration = opts.duration;
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.resolution) body.resolution = opts.resolution;
    if (opts.personGeneration) body.person_generation = opts.personGeneration;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (Number.isInteger(opts.seed)) body.seed = opts.seed;
    if (opts.image) body.image = imageInputToUrl(opts.image);

    console.log(`🎬 Requesting Google Veo video (${model})…`);
    const create = await gatewayRequest({
      host: opts.host, port: opts.port, apiKey: opts.apiKey,
      method: "POST", reqPath: "/v1/videos/generations", body, signal: controller.signal,
    });

    if (create.status !== 200 && create.status !== 201 && create.status !== 202) {
      const msg = create.body?.error?.message || create.body?.error || create.raw || `HTTP ${create.status}`;
      console.error(`❌ Failed to start video job (${create.status}): ${sanitizeText(msg)}`);
      return 1;
    }

    const requestId = create.body?.request_id || create.body?.id;
    if (!requestId) {
      console.error(`❌ Upstream response did not include a request_id: ${JSON.stringify(create.body)}`);
      return 1;
    }

    const connectionId = create.headers?.["x-9router-connection-id"] || null;
    console.log(`⏳ Job started: ${requestId}`);

    let lastLoggedStatus = "";
    const done = await pollUntilDone({
      host: opts.host,
      port: opts.port,
      apiKey: opts.apiKey,
      requestId,
      connectionId,
      timeoutSec: opts.timeoutSec,
      pollIntervalMs: opts.pollIntervalMs,
      signal: controller.signal,
      onProgress: (status, progress) => {
        const text = progress != null ? `${status} (${progress}%)` : status;
        if (text !== lastLoggedStatus) {
          console.log(`⏳ Status: ${text}`);
          lastLoggedStatus = text;
        }
      },
    });

    const videoUrl = done.video?.url || done.video_url || done.url;
    if (!videoUrl) {
      console.error(`❌ Job completed but no video URL returned: ${JSON.stringify(done)}`);
      return 1;
    }

    // The gateway returns its own /content URL (relative when it can't tell what
    // origin the client used) — resolve it against the gateway we just called.
    const gatewayOrigin = `http://${opts.host}:${opts.port}`;
    const downloadUrl = /^https?:/i.test(videoUrl) ? videoUrl : new URL(videoUrl, gatewayOrigin).toString();
    const downloadHeaders = {};
    if (downloadUrl.startsWith(gatewayOrigin)) {
      if (opts.apiKey) downloadHeaders.Authorization = `Bearer ${opts.apiKey}`;
      if (connectionId) downloadHeaders["x-connection-id"] = connectionId;
    }

    console.log(`📥 Downloading video…`);
    await downloadToFile(downloadUrl, opts.output, { signal: controller.signal, headers: downloadHeaders });
    console.log(`✅ Saved video to ${opts.output}`);
    return 0;
  } catch (err) {
    if (controller.signal.aborted) return 130;
    console.error(`❌ ${err?.message || err}`);
    return 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

module.exports = { run, parseArgs, HELP };
