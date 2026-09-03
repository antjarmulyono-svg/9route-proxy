// All intercepted domains + URL patterns per tool

const fs = require("fs");

const IS_DEV = process.env.NODE_ENV === "development";

// Resolve lsof absolute path — packaged apps / sudo secure_path may strip /usr/sbin from PATH
const LSOF_BIN = (() => {
  if (process.platform === "win32") return null;
  for (const p of ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof"]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* try next */ }
  }
  return "lsof"; // last-resort fallback (depends on PATH)
})();

const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "runtime.us-east-1.kiro.dev",
  "api2.cursor.sh",
];

const URL_PATTERNS = {
  antigravity: [":generateContent", ":streamGenerateContent"],
  copilot: ["/chat/completions", "/v1/messages", "/responses"],
  // Legacy path form. Kiro IDE 1.0.228+ posts to `/` with x-amz-target instead —
  // see isChatRequest() for the header-based match.
  kiro: ["/generateAssistantResponse"],
  cursor: ["/BidiAppend", "/RunSSE", "/RunPoll", "/Run"],
};

/**
 * Whether this request is a chat turn we should intercept (vs passthrough).
 * Kiro Runtime moved GenerateAssistantResponse from path `/generateAssistantResponse`
 * to `POST /` + `x-amz-target: KiroRuntimeService.GenerateAssistantResponse`
 * (verified via live mitmproxy capture of Kiro IDE 1.0.228).
 */
function isChatRequest(tool, req) {
  const patterns = URL_PATTERNS[tool] || [];
  if (patterns.some((p) => (req.url || "").includes(p))) return true;
  if (tool === "kiro") {
    const target = String(req.headers?.["x-amz-target"] || "");
    return target.includes("GenerateAssistantResponse");
  }
  return false;
}

// Synonym map: rawModel from request → canonical alias key in mitmAlias DB
const MODEL_SYNONYMS = {
  antigravity: {
    "gemini-default": "gemini-3.5-flash-low",
    "gemini-3.8-flash-high": "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium": "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low": "gemini-3.8-flash-low",
    "gemini-3.5-flash-high": "gemini-3-flash-agent",
    "gemini-3.5-flash-medium": "gemini-3.5-flash-low",
    "gemini-3.5-flash-extra-low": "gemini-3.5-flash-extra-low",
    "gemini-3.7-flash-high": "gemini-3.7-flash-high",
    "gemini-3.7-flash-medium": "gemini-3.7-flash-medium",
    "gemini-3.7-flash-low": "gemini-3.7-flash-low",
    "gemini-3.1-pro-high": "gemini-pro-agent",
    "gemini-3-pro-high": "gemini-pro-agent",
    "gemini-3-pro-low": "gemini-3.1-pro-low",
  },
};

// Pattern fallback: rawModel regex → canonical alias key (when exact + prefix match fail)
// Order matters: more specific patterns first. Catches AG renamed variants (e.g. gemini-pro-agent)
const MODEL_PATTERNS = {
  antigravity: [
    { match: /3\.8.*flash.*high|3\.8.*high/i,                      alias: "gemini-3.8-flash-high" },
    { match: /3\.8.*flash.*medium|3\.8.*medium/i,                  alias: "gemini-3.8-flash-medium" },
    { match: /3\.8.*flash.*low|3\.8.*low/i,                        alias: "gemini-3.8-flash-low" },
    { match: /3\.7.*flash.*high|3\.7.*high/i,                      alias: "gemini-3.7-flash-high" },
    { match: /3\.7.*flash.*medium|3\.7.*medium/i,                  alias: "gemini-3.7-flash-medium" },
    { match: /3\.7.*flash.*low|3\.7.*low/i,                        alias: "gemini-3.7-flash-low" },
    { match: /flash.*extra.*low|extra.*low.*flash|flash.*low|low.*flash/i, alias: "gemini-3.5-flash-extra-low" },
    { match: /flash.*medium|medium.*flash/i,                       alias: "gemini-3.5-flash-low" },
    { match: /flash.*agent|agent.*flash|flash/i,                   alias: "gemini-3-flash-agent" },
    { match: /pro.*low|low.*pro/i,                                 alias: "gemini-3.1-pro-low" },
    { match: /gemini.*pro|pro.*gemini/i,                           alias: "gemini-pro-agent" },
    { match: /opus/i,                                              alias: "claude-opus-4-6-thinking" },
    { match: /sonnet|claude/i,                                     alias: "claude-sonnet-4-6" },
    { match: /gpt.*oss|oss/i,                                      alias: "gpt-oss-120b-medium" },
  ],
};

// Models that must NEVER be re-routed — always passthrough to the real upstream, even when
// the tool's other models are mapped. Antigravity's tab-autocomplete (`tab_jump_flash_lite_preview`,
// `tab_flash_lite_preview`, requestType tab/tab_jump) is latency-critical inline completion; routing
// it through 9Router to an external chat model makes typing laggy and burns provider quota per
// keystroke. Without this guard the broad `flash` pattern in MODEL_PATTERNS hijacks them onto the
// flash-agent slot. Verified via MITM dump capture of streamGenerateContent (see AI_JOURNAL).
const MODEL_NO_MAP = {
  antigravity: [/^tab[_-]/i],
};

// URL substrings whose request/response should NOT be dumped to file (telemetry, polling, empty)
const LOG_BLACKLIST_URL_PARTS = [
  "recordCodeAssistMetrics",
  "recordTrajectoryAnalytics",
  "fetchAdminControls",
  "listExperiments",
  "fetchUserInfo",
];

function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h === "daily-cloudcode-pa.googleapis.com" || h === "cloudcode-pa.googleapis.com") return "antigravity";
  if (h === "q.us-east-1.amazonaws.com" || h === "codewhisperer.us-east-1.amazonaws.com" || h === "runtime.us-east-1.kiro.dev") return "kiro";
  if (h === "api2.cursor.sh") return "cursor";
  return null;
}

function isBinaryData(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.slice(0, Math.min(100, buffer.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
      nonPrintable++;
    }
    if (byte > 0x7E) nonPrintable++;
  }
  return (nonPrintable / sample.length) > 0.3;
}

// Extract model from URL path (Gemini), body (OpenAI/Anthropic), or Kiro conversationState.
function extractModel(url, body) {
  const urlMatch = url.match(/\/models\/([^/:]+)/);
  const urlModel = urlMatch?.[1] || null;

  if (isBinaryData(body)) return urlModel;

  try {
    const parsed = JSON.parse(body.toString());
    if (parsed.conversationState) {
      return parsed.conversationState.currentMessage?.userInputMessage?.modelId || null;
    }
    const model = urlModel || parsed.model || null;
    const cleanModelName = String(model).replace(/^models\//, "");
    if (cleanModelName === "gemini-3.6-flash-tiered" || cleanModelName === "gemini-3.7-flash-tiered") {
      const ver = cleanModelName.includes("3.7") ? "3.7" : "3.6";
      const rawLevel = parsed.request?.generationConfig?.thinkingConfig?.thinkingLevel
        || parsed.generationConfig?.thinkingConfig?.thinkingLevel;
      const level = ["high", "medium", "low"].includes(String(rawLevel).toLowerCase())
        ? String(rawLevel).toLowerCase()
        : "medium";
      return `gemini-${ver}-flash-${level}`;
    }
    return model;
  } catch {
    return urlModel;
  }
}

// BusyBox lsof (Alpine/Docker) ignores -iTCP/-sTCP/-t and dumps every fd of every
// process as "<pid>\t<cmd>\t<fd>\t<path>". Parsing that as a pid list yields NaN and
// a bogus "PID 1" owner, so on Linux resolve listeners from /proc instead of lsof.
const HAS_PROCFS = process.platform === "linux" && (() => {
  try { fs.accessSync("/proc/net/tcp", fs.constants.R_OK); return true; } catch { return false; }
})();

function listeningSocketInodes(port) {
  const inodes = new Set();
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of content.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      if (cols[3] !== "0A") continue; // TCP_LISTEN
      if (!cols[1].endsWith(`:${hexPort}`)) continue;
      if (cols[9] !== "0") inodes.add(cols[9]);
    }
  }
  return inodes;
}

/**
 * PIDs listening on a TCP port, read straight from procfs.
 * Returns null where procfs is unavailable (macOS, Windows) so callers fall back to lsof.
 * Note: /proc/<pid>/fd is only readable for our own processes unless we are root —
 * a listener owned by another user is silently skipped rather than misreported.
 */
function listeningPids(port) {
  if (!HAS_PROCFS) return null;
  const inodes = listeningSocketInodes(port);
  if (inodes.size === 0) return [];
  const pids = [];
  let entries;
  try { entries = fs.readdirSync("/proc"); } catch { return []; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds;
    try { fds = fs.readdirSync(`/proc/${entry}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link;
      try { link = fs.readlinkSync(`/proc/${entry}/fd/${fd}`); } catch { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) { pids.push(Number(entry)); break; }
    }
  }
  return pids;
}

function processNameForPid(pid) {
  if (!HAS_PROCFS) return "unknown";
  try {
    const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    if (comm) return comm;
  } catch { /* try cmdline */ }
  try {
    const argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean)[0];
    if (argv0) return argv0.split("/").pop();
  } catch { /* unknown */ }
  return "unknown";
}

module.exports = { IS_DEV, LSOF_BIN, listeningPids, processNameForPid, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, MODEL_NO_MAP, LOG_BLACKLIST_URL_PARTS, getToolForHost, isChatRequest, extractModel };
