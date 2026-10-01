// CJS reader for MITM standalone process. Reads mitmAlias from JSON cache
// at $DATA_DIR/mitm/aliases.json (synced by app from SQLite on startup + writes).
// JSON-only: no SQLite native binding required in MITM bundle.
const fs = require("fs");
const path = require("path");
const os = require("os");

function getDataDir() {
  return process.env.DATA_DIR
    || (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
      : path.join(os.homedir(), ".9router"));
}

function getCacheFile() {
  return path.join(getDataDir(), "mitm", "aliases.json");
}

function getClientsCacheFile() {
  return path.join(getDataDir(), "mitm", "clients.json");
}

function readCache() {
  try {
    const file = getCacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

function getMitmAlias(toolName) {
  const all = readCache();
  return all?.[toolName] || null;
}

function readClientsCache() {
  try {
    const file = getClientsCacheFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

function checkMitmClientAccess(clientIp) {
  if (!clientIp) return { allowed: true };
  const normalized = clientIp.replace(/^::ffff:/, "").trim();
  const rules = readClientsCache();
  if (!rules) return { allowed: true };
  const rule = rules[normalized];
  if (rule) {
    if (rule.enabled === false) {
      return { allowed: false, reason: "Client is disabled in 9Router" };
    }
    if (rule.tokenLimit > 0) {
      const used = rule.tokensUsedCurrentPeriod != null ? Number(rule.tokensUsedCurrentPeriod) : Number(rule.totalTokens || 0);
      if (used >= rule.tokenLimit) {
        return { allowed: false, reason: `Token limit exceeded: used ${used.toLocaleString()} of ${rule.tokenLimit.toLocaleString()} tokens` };
      }
    }
  }
  return { allowed: true };
}

function isClientEnabled(clientIp) {
  return checkMitmClientAccess(clientIp).allowed;
}

function getClientRules() {
  return readClientsCache() || {};
}

module.exports = { getMitmAlias, isClientEnabled, checkMitmClientAccess, getClientRules };
