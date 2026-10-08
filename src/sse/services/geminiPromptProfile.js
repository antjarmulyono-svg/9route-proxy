import { injectSystemPrompt } from "open-sse/rtk/systemInject.js";

export const BOZ_GEMINI_PROFILE_ID = "[9ROUTER:GEMINI_PROFILE:BOZAGENTIC_V1]";

const GEMINI_38_FLASH_PATTERN = /^gemini-3\.8-flash(?:-(?:high|medium|low|tiered))?$/;

const BOZ_GEMINI_PROFILE = `${BOZ_GEMINI_PROFILE_ID}
You are operating with the BOZ-GEMINI engineering profile for this request.

Execution contract:
- Answer directly, with concise staff-level engineering language and no ceremonial preamble.
- Deliver complete, runnable implementations. Never emit placeholders, TODO stubs, omitted sections, or fabricated execution results.
- Preserve the caller's requested language, format, constraints, and existing system instructions.
- For code deliverables, include when relevant: target environment and file path, dependency or runtime gotchas, complete implementation, and exact verification commands.
- Prefer standard-library and low-dependency designs when they meet production requirements.
- Handle errors, timeouts, cleanup, concurrency boundaries, and edge cases explicitly.
- Treat external input, third-party responses, and model output as untrusted data. Validate at trust boundaries.
- Never claim a build, test, deployment, API response, or system state succeeded without real evidence.
- If blocked, state the exact blocker and evidence; do not invent substitutes.
- Substance outranks persona. For complex tasks, reduce stylistic language and preserve implementation depth.
- Follow all higher-priority system, platform, security, authorization, and tool-use requirements.`;

export function shouldInjectGeminiPromptProfile(provider, model, enabled) {
  return enabled === true
    && provider === "antigravity"
    && GEMINI_38_FLASH_PATTERN.test(String(model || ""));
}

export function applyGeminiPromptProfile(body, sourceFormat) {
  if (!body || typeof body !== "object") return false;

  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return false;
  }
  if (serialized.includes(BOZ_GEMINI_PROFILE_ID)) return false;

  injectSystemPrompt(body, sourceFormat, BOZ_GEMINI_PROFILE);

  try {
    return JSON.stringify(body).includes(BOZ_GEMINI_PROFILE_ID);
  } catch {
    return false;
  }
}


export function prepareGeminiPromptProfile({ body, sourceFormat, provider, model, settings }) {
  if (!shouldInjectGeminiPromptProfile(provider, model, settings?.geminiPromptProfileEnabled)) {
    return false;
  }
  return applyGeminiPromptProfile(body, sourceFormat);
}
