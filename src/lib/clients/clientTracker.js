import { readClientsCache } from "../mitmClientCache.js";
import { recordClientActivity } from "../db/repos/clientsRepo.js";

export function normalizeIp(rawIp) {
  if (!rawIp) return "127.0.0.1";
  let ip = String(rawIp).trim();
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  if (ip === "::1") {
    ip = "127.0.0.1";
  }
  return ip;
}

export function extractClientIp(request) {
  if (!request) return "127.0.0.1";
  const headers = request.headers;
  
  // Custom server stamps unspoofable peer token and real IP
  const xRealIp = typeof headers.get === "function" 
    ? headers.get("x-9r-real-ip") || headers.get("x-real-ip") || headers.get("x-forwarded-for")
    : headers["x-9r-real-ip"] || headers["x-real-ip"] || headers["x-forwarded-for"];

  if (xRealIp) {
    const candidate = String(xRealIp).split(",")[0].trim();
    if (candidate) return normalizeIp(candidate);
  }

  // Node HTTP socket fallback
  const socketIp = request.socket?.remoteAddress || request.connection?.remoteAddress;
  return normalizeIp(socketIp);
}

export function detectToolFromRequest(request, body = null) {
  if (body?.userAgent === "antigravity") {
    return { tool: "Antigravity IDE", toolId: "antigravity", category: "mitm" };
  }

  const ua = (typeof request?.headers?.get === "function"
    ? request.headers.get("user-agent")
    : request?.headers?.["user-agent"]) || "";
  const lk = ua.toLowerCase();

  if (lk.includes("claude-code") || lk.includes("claude/")) {
    return { tool: "Claude Code", toolId: "claude", category: "cli" };
  }
  if (lk.includes("cline")) {
    return { tool: "Cline", toolId: "cline", category: "cli" };
  }
  if (lk.includes("roo") || lk.includes("roo-cline")) {
    return { tool: "Roo Code", toolId: "roo", category: "cli" };
  }
  if (lk.includes("continue")) {
    return { tool: "Continue.dev", toolId: "continue", category: "cli" };
  }
  if (lk.includes("cursor")) {
    return { tool: "Cursor", toolId: "cursor", category: "mitm" };
  }
  if (lk.includes("copilot") || lk.includes("github-copilot")) {
    return { tool: "GitHub Copilot", toolId: "copilot", category: "mitm" };
  }
  if (lk.includes("opencode")) {
    return { tool: "OpenCode", toolId: "opencode", category: "cli" };
  }
  if (lk.includes("openclaw")) {
    return { tool: "Open Claw", toolId: "openclaw", category: "cli" };
  }
  if (lk.includes("codex") || lk.includes("openai-codex")) {
    return { tool: "OpenAI Codex CLI / App", toolId: "codex", category: "cli" };
  }
  if (lk.includes("cowork")) {
    return { tool: "Claude Cowork", toolId: "cowork", category: "cli" };
  }
  if (lk.includes("droid")) {
    return { tool: "Factory Droid", toolId: "droid", category: "cli" };
  }
  if (lk.includes("deepseek")) {
    return { tool: "DeepSeek TUI", toolId: "deepseek-tui", category: "cli" };
  }
  if (lk.includes("grok")) {
    return { tool: "Grok Build", toolId: "grok-build", category: "cli" };
  }
  if (lk.includes("hermes")) {
    return { tool: "Hermes Agent", toolId: "hermes", category: "cli" };
  }
  if (lk.includes("jcode")) {
    return { tool: "jcode", toolId: "jcode", category: "cli" };
  }
  if (lk.includes("kilo")) {
    return { tool: "Kilo Code", toolId: "kilo", category: "cli" };
  }
  if (lk.includes("amp")) {
    return { tool: "Amp CLI", toolId: "amp", category: "cli" };
  }
  if (lk.includes("qwen")) {
    return { tool: "Qwen Code", toolId: "qwen", category: "cli" };
  }
  if (lk.includes("devin")) {
    return { tool: "Devin CLI", toolId: "devin", category: "cli" };
  }
  if (lk.includes("opendesign")) {
    return { tool: "OpenDesign", toolId: "opendesign", category: "cli" };
  }
  if (lk.includes("ai-sdk") || lk.includes("ai-sdk/openai-compat")) {
    return { tool: "AI SDK / OpenAI", toolId: "ai-sdk", category: "cli" };
  }
  if (lk.includes("curl/")) {
    return { tool: "cURL / Terminal", toolId: "curl", category: "cli" };
  }
  if (lk.includes("python-requests") || lk.includes("aiohttp") || lk.includes("openai/python")) {
    return { tool: "Python SDK", toolId: "python", category: "cli" };
  }
  if (lk.includes("node-fetch") || lk.includes("undici") || lk.includes("openai/js")) {
    return { tool: "Node SDK", toolId: "node", category: "cli" };
  }

  // Check endpoint path
  const url = request?.url || "";
  if (url.includes("/codex") || url.includes("/responses")) {
    return { tool: "OpenAI Codex CLI / App", toolId: "codex", category: "cli" };
  }

  return { 
    tool: ua ? `CLI (${ua.slice(0, 24)})` : "API Gateway", 
    toolId: "custom", 
    category: "cli" 
  };
}

export function isClientIpAllowed(ip) {
  const normalized = normalizeIp(ip);
  const cache = readClientsCache();
  const rule = cache[normalized];
  if (rule && rule.enabled === false) {
    return false;
  }
  return true;
}

export function trackIncomingRequest(request, body = null) {
  const ip = extractClientIp(request);
  const { tool, category } = detectToolFromRequest(request, body);
  const ua = (typeof request?.headers?.get === "function"
    ? request.headers.get("user-agent")
    : request?.headers?.["user-agent"]) || "";

  recordClientActivity(ip, { tool, category, userAgent: ua });
  return { ip, tool, category, allowed: isClientIpAllowed(ip) };
}
