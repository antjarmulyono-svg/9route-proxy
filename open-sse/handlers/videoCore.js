import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshTokenByProvider } from "../services/tokenRefresh.js";
import { PROVIDER_MEDIA } from "../providers/index.js";

// Upstream fetch deadline for video job submission/polling (the job itself is
// async upstream — this only bounds the HTTP round-trip, not video rendering).
const VIDEO_FETCH_TIMEOUT_MS = Number(process.env.VIDEO_FETCH_TIMEOUT_MS || 120000);

// POST /videos/* creates a billable upstream job. A network error after the
// request left the socket may still have created the job, so creation is NEVER
// auto-retried (the only re-send is the auth retry after a 401/403 refresh,
// which upstream rejects before job creation).
export const VIDEO_ACTIONS = new Set(["generations", "edits", "extensions"]);

export function getVideoConfig(provider) {
  return PROVIDER_MEDIA[provider]?.videoConfig || null;
}

/**
 * A request we reject before it reaches upstream — the caller's body or job id
 * is wrong, so the account behind it is healthy and must not be marked failing.
 */
function clientError(statusCode, message) {
  return { ...createErrorResult(statusCode, message), clientError: true };
}

/** Strip bearer tokens / obvious secrets from text destined for clients or logs. */
export function sanitizeSecrets(text, credentials = null) {
  if (!text) return text;
  let out = String(text).replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
  for (const key of ["accessToken", "refreshToken", "apiKey"]) {
    const secret = credentials?.[key];
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

// --- Gemini Veo job ids -----------------------------------------------------
// Veo operation names contain slashes ("models/{model}/operations/{op}"), which
// cannot survive `/v1/videos/{id}` as a single route segment — percent-encoded
// "%2F" is normalized back to "/" by proxies and by Next's rewrite, turning the
// poll into a 404. So the create response hands clients an opaque, slash-free
// token that also carries the provider (poll GETs have no body to infer it from).
const GEMINI_JOB_PREFIX = "gemini_";

// Operation names are interpolated into the upstream path — keep them to the
// exact shape Google issues so a crafted id can't reach another API path.
const GEMINI_OPERATION_RE = /^(models\/[A-Za-z0-9._-]+\/)?operations\/[A-Za-z0-9._-]+$/;

/** Wrap an upstream Veo operation name as an opaque, URL-safe job id. */
export function encodeGeminiJobId(operationName) {
  return GEMINI_JOB_PREFIX + Buffer.from(String(operationName), "utf8").toString("base64url");
}

/**
 * Recover the Veo operation name from a job id.
 * Accepts the opaque `gemini_…` token plus the legacy shapes earlier builds
 * emitted (raw "models/…" and the "~"-separated variant).
 * @returns {string|null} operation name, or null if this isn't a Veo job id
 */
export function decodeGeminiJobId(jobId) {
  if (!jobId) return null;
  const raw = String(jobId);

  if (raw.startsWith(GEMINI_JOB_PREFIX)) {
    const token = raw.slice(GEMINI_JOB_PREFIX.length);
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    // base64url decoding never throws — it drops invalid bytes. Re-encode to
    // confirm the token really is what it claims to be.
    if (!decoded || Buffer.from(decoded, "utf8").toString("base64url") !== token) return null;
    return GEMINI_OPERATION_RE.test(decoded) ? decoded : null;
  }

  let legacy = raw;
  try { legacy = decodeURIComponent(raw); } catch { /* already decoded */ }
  legacy = legacy.replace(/~/g, "/");
  return GEMINI_OPERATION_RE.test(legacy) ? legacy : null;
}

function buildUpstreamUrl(config, action, requestId, model) {
  const base = config.baseUrl.replace(/\/$/, "");
  if (config.format === "gemini-veo") {
    if (requestId) {
      // Operation names are multi-segment paths — encodeURIComponent would
      // escape the separators and break the lookup.
      return `${base}/${decodeGeminiJobId(requestId)}`;
    }
    const cleanModel = (model || "").replace(/^gemini\//, "");
    return `${base}/models/${encodeURIComponent(cleanModel)}:predictLongRunning`;
  }
  return requestId ? `${base}/${encodeURIComponent(requestId)}` : `${base}/${action}`;
}

function buildHeaders({ token, contentType, idempotencyKey, format, apiKey }) {
  const headers = { Accept: "application/json" };
  if (format === "gemini-veo") {
    if (apiKey) headers["x-goog-api-key"] = apiKey;
    else if (token) headers.Authorization = `Bearer ${token}`;
  } else {
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  }
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

function combineSignals(signal, timeoutMs) {
  const timeoutSignal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeoutSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal || timeoutSignal || undefined;
}

// OpenAI-style request field → Veo `parameters` field. Values are forwarded
// verbatim: Google validates them and its error text names the accepted values,
// which is more useful than a guess that silently rewrites the caller's intent.
const VEO_PARAM_ALIASES = {
  aspect_ratio: "aspectRatio",
  aspectRatio: "aspectRatio",
  negative_prompt: "negativePrompt",
  negativePrompt: "negativePrompt",
  person_generation: "personGeneration",
  personGeneration: "personGeneration",
  resolution: "resolution",
  seed: "seed",
};

/** data: URL / bare base64 → Veo's inline image shape. */
function toVeoImage(img) {
  if (img && typeof img === "object") {
    // Already Veo-shaped ({bytesBase64Encoded,mimeType} or {gcsUri}) — pass through.
    if (img.bytesBase64Encoded || img.gcsUri) return { image: img };
    if (typeof img.b64_json === "string") {
      return { image: { mimeType: img.mime_type || img.mimeType || "image/png", bytesBase64Encoded: img.b64_json } };
    }
    if (typeof img.url === "string") return toVeoImage(img.url);
    return { error: "Unsupported `image` object — expected {url}, {b64_json} or {bytesBase64Encoded,mimeType}" };
  }
  if (typeof img !== "string" || !img) return { error: "Unsupported `image` value — expected a data: URL or base64 string" };

  const match = img.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { image: { mimeType: match[1], bytesBase64Encoded: match[2] } };
  if (/^https?:/i.test(img)) {
    // Veo takes inline bytes or a gs:// URI — it cannot fetch an http(s) image,
    // and having the gateway fetch it would turn this endpoint into an SSRF vector.
    return { error: "`image` must be a data: URL or base64 bytes — http(s) image URLs are not supported by Veo" };
  }
  return { image: { mimeType: "image/jpeg", bytesBase64Encoded: img } };
}

/**
 * OpenAI-ish `/v1/videos/generations` body → Veo `predictLongRunning` body.
 * `instances` / `parameters` given explicitly win, so callers can reach Veo
 * fields this map doesn't know yet without waiting for a release.
 * @returns {{body: string}|{error: string}}
 */
function formatGeminiVeoBody(rawBody) {
  let parsed = null;
  if (typeof rawBody === "string") {
    try { parsed = JSON.parse(rawBody); } catch { /* noop */ }
  } else if (rawBody && typeof rawBody === "object" && !Buffer.isBuffer(rawBody)) {
    parsed = rawBody;
  }
  if (!parsed) return { error: "Veo requires a JSON body" };

  const parameters = {};
  for (const [field, veoField] of Object.entries(VEO_PARAM_ALIASES)) {
    if (parsed[field] != null) parameters[veoField] = parsed[field];
  }
  const duration = parsed.duration_seconds ?? parsed.durationSeconds ?? parsed.duration;
  if (duration != null) parameters.durationSeconds = Number(duration);
  const sampleCount = parsed.sample_count ?? parsed.sampleCount ?? parsed.n;
  if (sampleCount != null) parameters.sampleCount = Number(sampleCount);
  Object.assign(parameters, parsed.parameters || {});

  if (Array.isArray(parsed.instances)) {
    return { body: JSON.stringify({ instances: parsed.instances, parameters }) };
  }

  if (!parsed.prompt) return { error: "`prompt` is required for video generation" };
  const instance = { prompt: String(parsed.prompt) };

  if (parsed.image != null) {
    const { image, error } = toVeoImage(parsed.image);
    if (error) return { error };
    instance.image = image;
  }

  return { body: JSON.stringify({ instances: [instance], parameters }) };
}

/** Model id out of an operation name ("models/{model}/operations/{op}"). */
function modelFromOperationName(opName, fallback) {
  const match = /^models\/([^/]+)\/operations\//.exec(opName || "");
  return match ? match[1] : (fallback || "").replace(/^gemini\//, "") || null;
}

function transformGeminiVeoCreateResponse(bodyText, model) {
  try {
    const data = JSON.parse(bodyText);
    const opName = data.name || data.id || "";
    if (!opName) return bodyText;
    const jobId = encodeGeminiJobId(opName);
    return JSON.stringify({
      id: jobId,
      request_id: jobId,
      status: "pending",
      model: modelFromOperationName(opName, model),
      created: Math.floor(Date.now() / 1000),
    });
  } catch {
    return bodyText;
  }
}

/** Extract the finished sample regardless of which response envelope Veo used. */
function veoSample(data) {
  const response = data?.response || {};
  const generated = response.generateVideoResponse || response;
  return generated?.generatedSamples?.[0] || generated?.videos?.[0] || null;
}

function transformGeminiVeoPollResponse(bodyText, jobId, publicBaseUrl) {
  try {
    const data = JSON.parse(bodyText);
    const opName = data.name || decodeGeminiJobId(jobId) || "";
    const id = opName ? encodeGeminiJobId(opName) : jobId;
    const base = { id, request_id: id, model: modelFromOperationName(opName), created: Math.floor(Date.now() / 1000) };

    if (data.error) {
      return JSON.stringify({
        ...base,
        status: "failed",
        error: { message: data.error.message || "Video generation failed", code: data.error.code || 500 },
      });
    }
    if (!data.done) return JSON.stringify({ ...base, status: "in_progress" });

    const sample = veoSample(data);
    if (!sample) {
      // Everything the model produced was dropped by the safety filter — Veo
      // reports this as a successful operation with no samples.
      const generated = data.response?.generateVideoResponse || data.response || {};
      const reasons = generated.raiMediaFilteredReasons;
      return JSON.stringify({
        ...base,
        status: "failed",
        error: {
          message: Array.isArray(reasons) && reasons.length
            ? `Video was filtered: ${reasons.join("; ")}`
            : "Video generation finished without returning a video",
          code: HTTP_STATUS.BAD_REQUEST,
        },
      });
    }

    // The upstream file URI needs the Gemini API key to download. Hand back a
    // gateway URL instead so the key never leaves the server — /content streams
    // it through with the stored credential.
    return JSON.stringify({
      ...base,
      status: "done",
      video: {
        url: `${publicBaseUrl || ""}/v1/videos/${encodeURIComponent(id)}/content`,
        mime_type: sample.video?.mimeType || "video/mp4",
      },
    });
  } catch {
    return bodyText;
  }
}

/** Upstream file URI of a finished Veo job, or null while it is still running. */
export function geminiVideoFileUri(pollBodyText) {
  try {
    const data = JSON.parse(pollBodyText);
    if (!data.done || data.error) return null;
    const sample = veoSample(data);
    return sample?.video?.uri || sample?.video?.url || null;
  } catch {
    return null;
  }
}

/**
 * Proxy for async video jobs (xAI Grok Imagine, Google Veo).
 *
 * - xAI: forwards the raw body byte-for-byte (JSON or multipart) and passes the
 *   upstream JSON back verbatim — no reshaping.
 * - Veo: `predictLongRunning` needs a different body shape and returns an
 *   Operation, so both directions are translated into the same job envelope
 *   ({ request_id, status, video.url, error }) xAI already produces.
 * - 401/403 with a refresh token: refresh ONCE, retry ONCE. No other retry.
 * - Upstream error text is sanitized before it reaches the client.
 *
 * @param {object} options
 * @param {string} options.provider - Provider id (must have registry videoConfig)
 * @param {"generations"|"edits"|"extensions"|null} options.action - Creation action (POST)
 * @param {string|null} [options.model] - Model id, provider prefix already stripped
 * @param {string|null} [options.requestId] - Poll target (GET /videos/{id})
 * @param {Buffer|string|null} [options.rawBody] - Body to forward
 * @param {string|null} [options.contentType] - Original Content-Type header
 * @param {string|null} [options.idempotencyKey] - Forwarded Idempotency-Key
 * @param {object} options.credentials - { accessToken?, apiKey?, refreshToken?, authType? }
 * @param {AbortSignal} [options.signal] - Client cancellation signal
 * @param {number} [options.timeoutMs]
 * @param {object} [options.log]
 * @param {function} [options.onCredentialsRefreshed]
 * @param {string} [options.publicBaseUrl] - Origin used to build the video download URL
 * @param {boolean} [options.rawUpstream] - Skip response translation (internal callers)
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleVideoProxyCore({
  provider,
  action = null,
  model = null,
  requestId = null,
  rawBody = null,
  contentType = null,
  idempotencyKey = null,
  credentials,
  signal,
  timeoutMs = VIDEO_FETCH_TIMEOUT_MS,
  log,
  onCredentialsRefreshed,
  publicBaseUrl = "",
  rawUpstream = false,
}) {
  const config = getVideoConfig(provider);
  if (!config) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support video generation`);
  }
  if (!requestId && !VIDEO_ACTIONS.has(action)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Unknown video action: ${action}`);
  }
  if (config.format === "gemini-veo") {
    if (requestId && !decodeGeminiJobId(requestId)) {
      return clientError(HTTP_STATUS.BAD_REQUEST, "Malformed video job id");
    }
    // Veo addresses the model in the URL — never guess one, that would bill the
    // caller for a model they did not ask for.
    if (!requestId && !model) {
      return clientError(HTTP_STATUS.BAD_REQUEST, `[${provider}] a video model is required (e.g. gemini/veo-3.1-lite-generate-preview)`);
    }
  }

  const method = requestId ? "GET" : "POST";
  const url = buildUpstreamUrl(config, action, requestId, model);
  const fetchSignal = combineSignals(signal, timeoutMs);

  let finalBody = rawBody;
  let finalContentType = contentType;

  if (config.format === "gemini-veo" && method === "POST") {
    const formatted = formatGeminiVeoBody(rawBody);
    if (formatted.error) return clientError(HTTP_STATUS.BAD_REQUEST, `[${provider}] ${formatted.error}`);
    finalBody = formatted.body;
    finalContentType = "application/json";
  }

  const doFetch = (creds) => {
    const token = creds?.accessToken;
    const apiKey = creds?.apiKey;
    return fetch(url, {
      method,
      headers: buildHeaders({
        token,
        apiKey,
        format: config.format,
        contentType: method === "POST" ? finalContentType : null,
        idempotencyKey: method === "POST" ? idempotencyKey : null,
      }),
      body: method === "POST" ? finalBody : undefined,
      signal: fetchSignal,
    });
  };

  let upstream;
  try {
    upstream = await doFetch(credentials);
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return createErrorResult(HTTP_STATUS.REQUEST_TIMEOUT, `[${provider}] video ${method} aborted: ${error.message}`);
    }
    // Never re-send a creation POST on network error — the job may already exist upstream.
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video upstream fetch failed: ${error.message}`, credentials));
  }

  // 401/403 → refresh once → retry once (OAuth accounts only; API keys can't refresh)
  if (
    (upstream.status === HTTP_STATUS.UNAUTHORIZED || upstream.status === HTTP_STATUS.FORBIDDEN) &&
    credentials?.refreshToken
  ) {
    let refreshed = null;
    try {
      refreshed = await refreshTokenByProvider(provider, credentials, log);
    } catch (error) {
      log?.warn?.("TOKEN", `${provider} | video refresh error: ${sanitizeSecrets(error.message, credentials)}`);
    }
    if (refreshed?.accessToken) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for video ${method}`);
      Object.assign(credentials, refreshed);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(refreshed);
      try {
        await upstream.body?.cancel?.();
      } catch { /* noop */ }
      try {
        upstream = await doFetch(credentials);
      } catch (error) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video retry after refresh failed: ${error.message}`, credentials));
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | video refresh failed — account needs re-auth`);
    }
  }

  let bodyText = await upstream.text().catch(() => "");

  if (!upstream.ok) {
    const message = sanitizeSecrets(bodyText || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  // Veo speaks predictLongRunning/Operation — reshape it into the async job
  // envelope the rest of /v1/videos/* already returns. `rawUpstream` skips this
  // for internal callers that need the untouched operation (see /content).
  if (config.format === "gemini-veo" && !rawUpstream) {
    if (method === "POST") {
      bodyText = transformGeminiVeoCreateResponse(bodyText, model);
    } else if (method === "GET") {
      bodyText = transformGeminiVeoPollResponse(bodyText, requestId, publicBaseUrl);
    }
  }

  // Success: return standard JSON response
  return {
    success: true,
    response: new Response(bodyText, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
