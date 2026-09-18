import { getAdapter } from "../driver.js";
import { syncClientsToJson, writeClientRule, deleteClientRule } from "../../mitmClientCache.js";

function rowToClient(row) {
  if (!row) return null;
  return {
    ip: row.ip,
    name: row.name || "",
    enabled: row.enabled === 1 || row.enabled === true,
    tool: row.tool || "",
    category: row.category || "cli",
    userAgent: row.userAgent || "",
    lastSeen: Number(row.lastSeen) || 0,
    requestCount: Number(row.requestCount) || 0,
    notes: row.notes || "",
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
  };
}

export async function getAllClients() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM clients ORDER BY lastSeen DESC, createdAt DESC`);
  return rows.map(rowToClient);
}

export async function getClientByIp(ip) {
  if (!ip) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM clients WHERE ip = ?`, [ip]);
  return rowToClient(row);
}

export async function upsertClient(clientData) {
  if (!clientData || !clientData.ip) throw new Error("Client IP is required");
  const db = await getAdapter();
  const now = Date.now();
  const existing = await getClientByIp(clientData.ip);

  const client = {
    ip: clientData.ip,
    name: clientData.name !== undefined ? clientData.name : (existing?.name || ""),
    enabled: clientData.enabled !== undefined ? Boolean(clientData.enabled) : (existing ? existing.enabled : true),
    tool: clientData.tool || existing?.tool || "Unknown",
    category: clientData.category || existing?.category || "cli",
    userAgent: clientData.userAgent || existing?.userAgent || "",
    lastSeen: clientData.lastSeen || existing?.lastSeen || now,
    requestCount: clientData.requestCount !== undefined ? clientData.requestCount : (existing?.requestCount || 0),
    notes: clientData.notes !== undefined ? clientData.notes : (existing?.notes || ""),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO clients(ip, name, enabled, tool, category, userAgent, lastSeen, requestCount, notes, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       name = excluded.name,
       enabled = excluded.enabled,
       tool = excluded.tool,
       category = excluded.category,
       userAgent = excluded.userAgent,
       lastSeen = excluded.lastSeen,
       requestCount = excluded.requestCount,
       notes = excluded.notes,
       updatedAt = excluded.updatedAt`,
    [
      client.ip,
      client.name,
      client.enabled ? 1 : 0,
      client.tool,
      client.category,
      client.userAgent,
      client.lastSeen,
      client.requestCount,
      client.notes,
      client.createdAt,
      client.updatedAt,
    ]
  );

  writeClientRule(client.ip, client.enabled, client.name);
  return client;
}

export async function toggleClient(ip, enabled) {
  if (!ip) throw new Error("Client IP is required");
  const db = await getAdapter();
  const now = Date.now();
  const numericEnabled = enabled ? 1 : 0;
  
  // Ensure record exists
  const existing = await getClientByIp(ip);
  if (!existing) {
    return await upsertClient({ ip, enabled, createdAt: now, updatedAt: now });
  }

  db.run(`UPDATE clients SET enabled = ?, updatedAt = ? WHERE ip = ?`, [numericEnabled, now, ip]);
  writeClientRule(ip, enabled, existing.name);
  return { ...existing, enabled: Boolean(enabled), updatedAt: now };
}

export async function deleteClient(ip) {
  if (!ip) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM clients WHERE ip = ?`, [ip]);
  deleteClientRule(ip);
  return (res?.changes ?? 0) > 0;
}

// Memory buffer for rapid in-flight requests to avoid heavy SQLite writes
const activityBuffer = new Map();
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (activityBuffer.size === 0) return;
    const items = Array.from(activityBuffer.values());
    activityBuffer.clear();

    try {
      const db = await getAdapter();
      const now = Date.now();
      const minuteBucket = Math.floor(now / 60000) * 60000;
      db.transaction(() => {
        for (const item of items) {
          db.run(
            `INSERT INTO clients(ip, name, enabled, tool, category, userAgent, lastSeen, requestCount, notes, createdAt, updatedAt)
             VALUES(?, ?, 1, ?, ?, ?, ?, ?, '', ?, ?)
             ON CONFLICT(ip) DO UPDATE SET
               tool = COALESCE(excluded.tool, clients.tool),
               category = COALESCE(excluded.category, clients.category),
               userAgent = COALESCE(excluded.userAgent, clients.userAgent),
               lastSeen = excluded.lastSeen,
               requestCount = clients.requestCount + excluded.requestCount,
               updatedAt = excluded.updatedAt`,
            [
              item.ip,
              item.name || "",
              item.tool || "CLI Tool",
              item.category || "cli",
              item.userAgent || "",
              item.lastSeen || now,
              item.count || 1,
              now,
              now,
            ]
          );

          try {
            db.run(
              `INSERT INTO clientActivityTimeline(ip, minuteBucket, requestCount)
               VALUES(?, ?, ?)
               ON CONFLICT(ip, minuteBucket) DO UPDATE SET
                 requestCount = clientActivityTimeline.requestCount + excluded.requestCount`,
              [item.ip, minuteBucket, item.count || 1]
            );
          } catch {
            // Table might not exist yet if migration pending
          }
        }
      });
      syncClientsToJson().catch(() => {});
    } catch (e) {
      console.log("[clientsRepo] activity flush failed:", e.message);
    }
  }, 1500);
}

export function recordClientActivity(ip, { tool = "CLI Tool", category = "cli", userAgent = "" } = {}) {
  if (!ip) return;
  const now = Date.now();
  const existing = activityBuffer.get(ip) || { ip, count: 0, lastSeen: now, tool, category, userAgent };
  existing.count += 1;
  existing.lastSeen = now;
  if (tool) existing.tool = tool;
  if (category) existing.category = category;
  if (userAgent) existing.userAgent = userAgent;
  activityBuffer.set(ip, existing);
  scheduleFlush();
}

/**
 * Get aggregated activity timeline for clients.
 * @param {string} period - "1h" | "24h" | "7d"
 * @param {string} filterIp - "all" | specific IP
 */
export async function getClientActivityStats(period = "24h", filterIp = "all") {
  const db = await getAdapter();
  const now = Date.now();

  // Ensure table exists safely
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS clientActivityTimeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      minuteBucket INTEGER NOT NULL,
      requestCount INTEGER DEFAULT 0
    )`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_ip_bucket ON clientActivityTimeline(ip, minuteBucket)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cat_bucket ON clientActivityTimeline(minuteBucket)`);
  } catch {}

  let bucketCount = 24;
  let bucketMs = 3600000; // 1h
  let startTime = now - bucketCount * bucketMs;
  let labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  if (period === "1h") {
    bucketCount = 30;
    bucketMs = 120000; // 2 min
    startTime = now - bucketCount * bucketMs;
    labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } else if (period === "7d") {
    bucketCount = 7;
    bucketMs = 86400000; // 1 day
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    startTime = startOfToday.getTime() - (bucketCount - 1) * bucketMs;
    labelFn = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = startTime + i * bucketMs;
    return {
      timestamp: bucketStart,
      label: labelFn(bucketStart),
      requests: 0,
      activeClients: 0,
      clientBreakdown: {},
    };
  });

  // Query recorded timeline
  let where = "WHERE minuteBucket >= ?";
  const params = [startTime];
  if (filterIp && filterIp !== "all") {
    where += " AND ip = ?";
    params.push(filterIp);
  }

  const rows = db.all(
    `SELECT ip, minuteBucket, requestCount FROM clientActivityTimeline ${where} ORDER BY minuteBucket ASC`,
    params
  );

  for (const r of rows) {
    const ts = Number(r.minuteBucket);
    if (ts < startTime) continue;
    const idx = Math.min(Math.floor((ts - startTime) / bucketMs), bucketCount - 1);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx].requests += r.requestCount || 0;
      buckets[idx].clientBreakdown[r.ip] = (buckets[idx].clientBreakdown[r.ip] || 0) + (r.requestCount || 0);
    }
  }

  // Include in-flight buffer memory
  const bufferItems = Array.from(activityBuffer.values());
  for (const item of bufferItems) {
    if (filterIp && filterIp !== "all" && item.ip !== filterIp) continue;
    const idx = Math.min(Math.floor((now - startTime) / bucketMs), bucketCount - 1);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx].requests += item.count || 0;
      buckets[idx].clientBreakdown[item.ip] = (buckets[idx].clientBreakdown[item.ip] || 0) + (item.count || 0);
    }
  }

  for (const b of buckets) {
    b.activeClients = Object.keys(b.clientBreakdown).length;
  }

  return {
    period,
    filterIp,
    startTime,
    endTime: now,
    buckets,
  };
}
