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
    return { tool: "Antigravity IDE", category: "mitm" };
  }

  const ua = (typeof request?.headers?.get === "function"
    ? request.headers.get("user-agent")
    : request?.headers?.["user-agent"]) || "";
  const lk = ua.toLowerCase();

  if (lk.includes("claude-code") || lk.includes("claude/")) {
    return { tool: "Claude Code", category: "cli" };
  }
  if (lk.includes("cline")) {
    return { tool: "Cline", category: "cli" };
  }
  if (lk.includes("cursor")) {
    return { tool: "Cursor", category: "mitm" };
  }
  if (lk.includes("copilot") || lk.includes("github-copilot")) {
    return { tool: "GitHub Copilot", category: "mitm" };
  }
  if (lk.includes("opencode")) {
    return { tool: "OpenCode", category: "cli" };
  }
  if (lk.includes("openclaw")) {
    return { tool: "OpenClaw", category: "cli" };
  }
  if (lk.includes("codex")) {
    return { tool: "Codex", category: "cli" };
  }
  if (lk.includes("droid")) {
    return { tool: "Droid", category: "cli" };
  }
  if (lk.includes("deepseek")) {
    return { tool: "DeepSeek TUI", category: "cli" };
  }
  if (lk.includes("grok")) {
    return { tool: "Grok Build", category: "cli" };
  }
  if (lk.includes("hermes")) {
    return { tool: "Hermes", category: "cli" };
  }
  if (lk.includes("jcode")) {
    return { tool: "JCode", category: "cli" };
  }
  if (lk.includes("kilo")) {
    return { tool: "Kilo", category: "cli" };
  }
  if (lk.includes("curl/")) {
    return { tool: "cURL / Terminal", category: "cli" };
  }
  if (lk.includes("python-requests") || lk.includes("aiohttp") || lk.includes("openai/python")) {
    return { tool: "Python SDK", category: "cli" };
  }
  if (lk.includes("node-fetch") || lk.includes("undici") || lk.includes("openai/js")) {
    return { tool: "Node SDK", category: "cli" };
  }

  // Check endpoint path
  const url = request?.url || "";
  if (url.includes("/codex") || url.includes("/responses")) {
    return { tool: "Codex", category: "cli" };
  }

  return { tool: ua ? `CLI (${ua.slice(0, 20)})` : "API Gateway", category: "cli" };
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
