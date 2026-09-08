// CJS reader for MITM standalone process. Reads mitmAlias from JSON cache
// at $DATA_DIR/mitm/aliases.json (synced by app from SQLite on startup + writes).
// JSON-only: no SQLite native binding required in MITM bundle.
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");

const CACHE_FILE = path.join(DATA_DIR, "mitm", "aliases.json");

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch { return null; }
}

function getMitmAlias(toolName) {
  const all = readCache();
  return all?.[toolName] || null;
}

const CLIENTS_CACHE_FILE = path.join(DATA_DIR, "mitm", "clients.json");

function readClientsCache() {
  try {
    if (!fs.existsSync(CLIENTS_CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CLIENTS_CACHE_FILE, "utf-8"));
  } catch { return null; }
}

function isClientEnabled(clientIp) {
  if (!clientIp) return true;
  const normalized = clientIp.replace(/^::ffff:/, "").trim();
  const rules = readClientsCache();
  if (!rules) return true;
  const rule = rules[normalized];
  if (rule && rule.enabled === false) {
    return false;
  }
  return true;
}

function getClientRules() {
  return readClientsCache() || {};
}

module.exports = { getMitmAlias, isClientEnabled, getClientRules };
