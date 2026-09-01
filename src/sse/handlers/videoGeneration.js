import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import {
  handleVideoProxyCore,
  getVideoConfig,
  sanitizeSecrets,
  decodeGeminiJobId,
  geminiVideoFileUri,
} from "open-sse/handlers/videoCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import * as log from "../utils/logger.js";

// Video generation default fallback provider (for bare grok models without provider prefix)
const DEFAULT_VIDEO_PROVIDER = "xai";

// Creation POSTs are billable jobs — only rotate to another account for
// errors that upstream rejects BEFORE creating a job (auth/quota). A 5xx may
// have created the job, so it is returned to the caller instead of re-sent.
const CREATE_ROTATION_STATUSES = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.RATE_LIMITED,
]);

async function requireValidApiKey(request) {
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

/**
 * Read the request body once, byte-preserving.
 * JSON bodies are additionally parsed so the `model` provider prefix can be
 * resolved (and stripped) — everything else is forwarded exactly as received.
 */
async function readForwardableBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    return { raw, parsed, contentType };
  }
  // Multipart (or any other content type): forward the exact bytes — parsing
  // and re-encoding FormData would change the multipart boundary.
  const buf = Buffer.from(await request.arrayBuffer());
  return { raw: buf, parsed: null, contentType };
}

async function resolveVideoProvider(parsedBody) {
  if (!parsedBody?.model) return { provider: DEFAULT_VIDEO_PROVIDER, model: null };

  const modelStr = String(parsedBody.model);
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos are not supported for video generation") };
  }
  if (!getVideoConfig(modelInfo.provider)) {
    // Bare model ids: if it matches a known veo model, route to gemini; otherwise fallback to default video provider
    if (!modelStr.includes("/")) {
      if (modelStr.startsWith("veo-")) {
        return { provider: "gemini", model: modelStr };
      }
      return { provider: DEFAULT_VIDEO_PROVIDER, model: modelStr };
    }
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${modelInfo.provider}' does not support video generation`) };
  }
  return { provider: modelInfo.provider, model: modelInfo.model };
}

/**
 * Origin the client reached us on — used to build the video download URL.
 * Mirrors getSamlBaseUrl(): explicit config first, then forwarding headers.
 */
function publicOrigin(request) {
  const configured = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (host) {
    const proto = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol || "http:").replace(/:$/, "");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/**
 * Which provider owns a poll/download id.
 * Veo job ids decode to an operation name; anything else is an opaque xAI id.
 */
function providerForJobId(requestId, request) {
  if (decodeGeminiJobId(requestId)) return "gemini";
  if (request?.headers.get("x-provider") === "gemini") return "gemini";
  return DEFAULT_VIDEO_PROVIDER;
}

function withConnectionHeader(response, connectionId) {
  if (!connectionId) return response;
  const headers = new Headers(response.headers);
  // Video jobs are account-bound upstream — clients echo this back as
  // `x-connection-id` on GET polls so the same account is used.
  headers.set("x-9router-connection-id", String(connectionId));
  return new Response(response.body, { status: response.status, headers });
}

/**
 * POST /v1/videos/{generations|edits|extensions} — async job creation proxy.
 */
export async function handleVideoCreate(request, action) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  const bodyInfo = await readForwardableBody(request);
  if (bodyInfo.error) return bodyInfo.error;

  const resolved = await resolveVideoProvider(bodyInfo.parsed);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;

  // Strip the provider prefix (e.g. "xai/grok-imagine-video" or "gemini/veo-3.1-generate-preview")
  let forwardBody = bodyInfo.raw;
  if (bodyInfo.parsed && model && bodyInfo.parsed.model !== model) {
    forwardBody = JSON.stringify({ ...bodyInfo.parsed, model });
  }

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const idempotencyKey = request.headers.get("idempotency-key") || null;

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model || "video"}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleVideoProxyCore({
      provider,
      action,
      model,
      rawBody: forwardBody,
      contentType: bodyInfo.contentType || null,
      idempotencyKey,
      credentials: refreshedCredentials,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
    });

    if (result.success) {
      await clearAccountError(credentials.connectionId, credentials, model);
      log.info("VIDEO", `${provider.toUpperCase()} | ${action} accepted (connection ${credentials.connectionId})`);
      return withConnectionHeader(result.response, credentials.connectionId);
    }

    // Rejected before it left the gateway (bad body) — nothing wrong with the account.
    if (result.clientError) return result.response;

    // Record the failure (dashboard shows lastError/errorCode → user sees re-auth is needed)
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, model
    );

    if (shouldFallback && CREATE_ROTATION_STATUSES.has(result.status)) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/**
 * GET /v1/videos/{request_id} — poll job status.
 * Jobs are account-bound upstream, so no cross-account rotation here: the
 * caller pins the creating account via `x-connection-id` (returned on create).
 */
export async function handleVideoGet(request, requestId) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");

  const provider = providerForJobId(requestId, request);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;

  const credentials = await getProviderCredentials(provider, null, null, { preferredConnectionId });
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  const result = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    publicBaseUrl: publicOrigin(request),
    log,
    onCredentialsRefreshed: async (newCreds) => {
      await updateProviderCredentials(credentials.connectionId, {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken,
        providerSpecificData: newCreds.providerSpecificData,
        testStatus: "active",
      });
    },
  });

  if (result.success) {
    await clearAccountError(credentials.connectionId, credentials, null);
    return withConnectionHeader(result.response, credentials.connectionId);
  }

  if (!result.clientError) {
    await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null
    );
  }
  return result.response;
}

// Veo delivers finished videos as Files API URIs that only open with the Gemini
// API key. Downloads are streamed through the gateway so that key stays server-side.
const GEMINI_FILE_HOST = "generativelanguage.googleapis.com";

/**
 * GET /v1/videos/{request_id}/content — stream the finished video bytes.
 * Veo only; xAI hands back a directly downloadable URL and never reaches here.
 */
export async function handleVideoContent(request, requestId) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");
  if (!decodeGeminiJobId(requestId)) {
    return errorResponse(HTTP_STATUS.NOT_FOUND, "Video download is only available for Google Veo jobs");
  }

  const provider = "gemini";
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const credentials = await getProviderCredentials(provider, null, null, { preferredConnectionId });
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }
  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  // Re-read the operation (untranslated) to get the current file URI — they are
  // short-lived, so resolving at download time beats caching one from the poll.
  const result = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    rawUpstream: true,
    log,
    onCredentialsRefreshed: async (newCreds) => {
      await updateProviderCredentials(credentials.connectionId, {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken,
        providerSpecificData: newCreds.providerSpecificData,
        testStatus: "active",
      });
    },
  });
  if (!result.success) return result.response;

  const fileUri = geminiVideoFileUri(await result.response.text());
  if (!fileUri) {
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Video is not ready — poll GET /v1/videos/${requestId} until status is "done"`);
  }

  let target;
  try {
    target = new URL(fileUri);
  } catch {
    return errorResponse(HTTP_STATUS.BAD_GATEWAY, "Upstream returned an unusable video URL");
  }
  // The API key rides on this request — never send it anywhere but Google.
  if (target.hostname !== GEMINI_FILE_HOST) {
    return errorResponse(HTTP_STATUS.BAD_GATEWAY, `Refusing to download video from unexpected host: ${target.hostname}`);
  }

  const headers = refreshedCredentials?.apiKey
    ? { "x-goog-api-key": refreshedCredentials.apiKey }
    : { Authorization: `Bearer ${refreshedCredentials?.accessToken || ""}` };

  let upstream;
  try {
    upstream = await fetch(target, { headers, signal: request.signal });
  } catch (error) {
    return errorResponse(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video download failed: ${error.message}`, refreshedCredentials));
  }
  if (!upstream.ok) {
    const message = sanitizeSecrets(await upstream.text().catch(() => ""), refreshedCredentials);
    return errorResponse(upstream.status, `[${provider}] video download failed: ${message.slice(0, 500) || `HTTP ${upstream.status}`}`);
  }

  const outHeaders = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "video/mp4",
    "Content-Disposition": `attachment; filename="${requestId}.mp4"`,
    "Access-Control-Allow-Origin": "*",
  });
  const length = upstream.headers.get("content-length");
  if (length) outHeaders.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers: outHeaders });
}
