// JSON cache for client rules & status — read by standalone MITM process (no SQLite native binding).
// Source of truth = SQLite `clients` table.
import fs from "fs";
import path from "path";
import os from "os";

function getDataDir() {
  return process.env.DATA_DIR
    || (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
      : path.join(os.homedir(), ".9router"));
}

function getCacheFile() {
  return path.join(getDataDir(), "mitm", "clients.json");
}

function writeAtomic(data) {
  const cacheFile = getCacheFile();
  const dir = path.dirname(cacheFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${cacheFile}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, cacheFile);
}

// Read raw cache (safe for sync / fallback)
export function readClientsCache() {
  try {
    const cacheFile = getCacheFile();
    if (!fs.existsSync(cacheFile)) return {};
    return JSON.parse(fs.readFileSync(cacheFile, "utf8")) || {};
  } catch {
    return {};
  }
}

// Sync entire clients map from DB → JSON file
export async function syncClientsToJson() {
  try {
    const { getAllClients } = await import("./db/repos/clientsRepo.js");
    const all = await getAllClients();
    const map = {};
    for (const c of all) {
      map[c.ip] = {
        enabled: c.enabled !== false,
        name: c.name || "",
        tool: c.tool || "",
        lastSeen: c.lastSeen || 0,
        tokenLimit: c.tokenLimit || 0,
        tokenLimitPeriod: c.tokenLimitPeriod || "all",
        tokensUsedCurrentPeriod: c.tokensUsedCurrentPeriod || 0,
        totalTokens: c.totalTokens || 0,
        periodResetAt: c.periodResetAt || 0,
      };
    }
    writeAtomic(map);
  } catch (e) {
    console.log("[mitmClientCache] sync failed:", e.message);
  }
}

// Update single client rule in cache immediately
export function writeClientRule(ip, enabled, name = "", extra = {}) {
  try {
    const current = readClientsCache();
    current[ip] = {
      ...(current[ip] || {}),
      enabled: Boolean(enabled),
      ...(name ? { name } : {}),
      ...extra,
      updatedAt: Date.now(),
    };
    writeAtomic(current);
  } catch (e) {
    console.log("[mitmClientCache] write rule failed:", e.message);
  }
}

// Delete client rule from cache immediately
export function deleteClientRule(ip) {
  try {
    const current = readClientsCache();
    if (current[ip]) {
      delete current[ip];
      writeAtomic(current);
    }
  } catch (e) {
    console.log("[mitmClientCache] delete rule failed:", e.message);
  }
}
