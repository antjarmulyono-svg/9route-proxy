import { getAdapter } from "../driver.js";
import { syncClientsToJson, writeClientRule, deleteClientRule } from "../../mitmClientCache.js";

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

function calculateNextReset(period, now = Date.now()) {
  if (period === "daily") {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  if (period === "monthly") {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return 0; // 'all' time limit has no auto-reset
}

function checkPeriodReset(row, now = Date.now()) {
  if (!row) return row;
  const period = row.tokenLimitPeriod || "all";
  if (period === "all") return row;

  const resetAt = Number(row.periodResetAt) || 0;
  if (resetAt > 0 && now >= resetAt) {
    row.tokensUsedCurrentPeriod = 0;
    row.periodResetAt = calculateNextReset(period, now);
  } else if (!resetAt) {
    row.periodResetAt = calculateNextReset(period, now);
  }
  return row;
}

function rowToClient(row) {
  if (!row) return null;
  const checked = checkPeriodReset(row);
  return {
    ip: checked.ip,
    name: checked.name || "",
    enabled: checked.enabled === 1 || checked.enabled === true,
    tool: checked.tool || "",
    category: checked.category || "cli",
    userAgent: checked.userAgent || "",
    lastSeen: Number(checked.lastSeen) || 0,
    requestCount: Number(checked.requestCount) || 0,
    promptTokens: Number(checked.promptTokens) || 0,
    completionTokens: Number(checked.completionTokens) || 0,
    totalTokens: Number(checked.totalTokens) || 0,
    tokenLimit: Number(checked.tokenLimit) || 0,
    tokenLimitPeriod: checked.tokenLimitPeriod || "all",
    tokensUsedCurrentPeriod: Number(checked.tokensUsedCurrentPeriod) || 0,
    periodResetAt: Number(checked.periodResetAt) || 0,
    notes: checked.notes || "",
    createdAt: Number(checked.createdAt) || 0,
    updatedAt: Number(checked.updatedAt) || 0,
  };
}

export async function getAllClients() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM clients ORDER BY lastSeen DESC, createdAt DESC`);
  return rows.map(rowToClient);
}

export async function getClientByIp(ip) {
  if (!ip) return null;
  const cleanIp = normalizeIp(ip);
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM clients WHERE ip = ?`, [cleanIp]);
  return rowToClient(row);
}

export async function upsertClient(clientData) {
  if (!clientData || !clientData.ip) throw new Error("Client IP is required");
  const cleanIp = normalizeIp(clientData.ip);
  const db = await getAdapter();
  const now = Date.now();
  const existing = await getClientByIp(cleanIp);

  const tokenLimitPeriod = clientData.tokenLimitPeriod !== undefined 
    ? clientData.tokenLimitPeriod 
    : (existing?.tokenLimitPeriod || "all");

  const periodResetAt = clientData.periodResetAt !== undefined
    ? clientData.periodResetAt
    : (existing?.periodResetAt || calculateNextReset(tokenLimitPeriod, now));

  const client = {
    ip: cleanIp,
    name: clientData.name !== undefined ? clientData.name : (existing?.name || ""),
    enabled: clientData.enabled !== undefined ? Boolean(clientData.enabled) : (existing ? existing.enabled : true),
    tool: clientData.tool || existing?.tool || "Unknown",
    category: clientData.category || existing?.category || "cli",
    userAgent: clientData.userAgent || existing?.userAgent || "",
    lastSeen: clientData.lastSeen || existing?.lastSeen || now,
    requestCount: clientData.requestCount !== undefined ? clientData.requestCount : (existing?.requestCount || 0),
    promptTokens: clientData.promptTokens !== undefined ? clientData.promptTokens : (existing?.promptTokens || 0),
    completionTokens: clientData.completionTokens !== undefined ? clientData.completionTokens : (existing?.completionTokens || 0),
    totalTokens: clientData.totalTokens !== undefined ? clientData.totalTokens : (existing?.totalTokens || 0),
    tokenLimit: clientData.tokenLimit !== undefined ? Number(clientData.tokenLimit) : (existing?.tokenLimit || 0),
    tokenLimitPeriod,
    tokensUsedCurrentPeriod: clientData.tokensUsedCurrentPeriod !== undefined 
      ? Number(clientData.tokensUsedCurrentPeriod) 
      : (existing?.tokensUsedCurrentPeriod || 0),
    periodResetAt,
    notes: clientData.notes !== undefined ? clientData.notes : (existing?.notes || ""),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO clients(
       ip, name, enabled, tool, category, userAgent, lastSeen, requestCount,
       promptTokens, completionTokens, totalTokens,
       tokenLimit, tokenLimitPeriod, tokensUsedCurrentPeriod, periodResetAt,
       notes, createdAt, updatedAt
     )
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       name = excluded.name,
       enabled = excluded.enabled,
       tool = excluded.tool,
       category = excluded.category,
       userAgent = excluded.userAgent,
       lastSeen = excluded.lastSeen,
       requestCount = excluded.requestCount,
       promptTokens = excluded.promptTokens,
       completionTokens = excluded.completionTokens,
       totalTokens = excluded.totalTokens,
       tokenLimit = excluded.tokenLimit,
       tokenLimitPeriod = excluded.tokenLimitPeriod,
       tokensUsedCurrentPeriod = excluded.tokensUsedCurrentPeriod,
       periodResetAt = excluded.periodResetAt,
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
      client.promptTokens,
      client.completionTokens,
      client.totalTokens,
      client.tokenLimit,
      client.tokenLimitPeriod,
      client.tokensUsedCurrentPeriod,
      client.periodResetAt,
      client.notes,
      client.createdAt,
      client.updatedAt,
    ]
  );

  writeClientRule(client.ip, client.enabled, client.name, {
    tool: client.tool,
    tokenLimit: client.tokenLimit,
    tokenLimitPeriod: client.tokenLimitPeriod,
    tokensUsedCurrentPeriod: client.tokensUsedCurrentPeriod,
    totalTokens: client.totalTokens,
    periodResetAt: client.periodResetAt,
  });
  return client;
}

export async function resetClientUsage(ip) {
  if (!ip) throw new Error("Client IP is required");
  const cleanIp = normalizeIp(ip);
  const db = await getAdapter();
  const now = Date.now();
  db.run(
    `UPDATE clients 
     SET tokensUsedCurrentPeriod = 0, updatedAt = ? 
     WHERE ip = ?`,
    [now, cleanIp]
  );
  writeClientRule(cleanIp, true, "", { tokensUsedCurrentPeriod: 0 });
  return await getClientByIp(cleanIp);
}

export async function toggleClient(ip, enabled) {
  if (!ip) throw new Error("Client IP is required");
  const cleanIp = normalizeIp(ip);
  const db = await getAdapter();
  const now = Date.now();
  const numericEnabled = enabled ? 1 : 0;
  
  const existing = await getClientByIp(cleanIp);
  if (!existing) {
    return await upsertClient({ ip: cleanIp, enabled, createdAt: now, updatedAt: now });
  }

  db.run(`UPDATE clients SET enabled = ?, updatedAt = ? WHERE ip = ?`, [numericEnabled, now, cleanIp]);
  writeClientRule(cleanIp, enabled, existing.name);
  return { ...existing, enabled: Boolean(enabled), updatedAt: now };
}

export async function deleteClient(ip) {
  if (!ip) return false;
  const cleanIp = normalizeIp(ip);
  const db = await getAdapter();
  const res = db.run(`DELETE FROM clients WHERE ip = ?`, [cleanIp]);
  deleteClientRule(cleanIp);
  return (res?.changes ?? 0) > 0;
}

// Memory buffer for rapid in-flight requests and tokens
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
          const pTok = item.promptTokens || 0;
          const cTok = item.completionTokens || 0;
          const tTok = pTok + cTok;

          db.run(
            `INSERT INTO clients(
               ip, name, enabled, tool, category, userAgent, lastSeen, requestCount,
               promptTokens, completionTokens, totalTokens,
               tokenLimit, tokenLimitPeriod, tokensUsedCurrentPeriod, periodResetAt,
               notes, createdAt, updatedAt
             )
             VALUES(?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'all', ?, 0, '', ?, ?)
             ON CONFLICT(ip) DO UPDATE SET
               tool = COALESCE(excluded.tool, clients.tool),
               category = COALESCE(excluded.category, clients.category),
               userAgent = COALESCE(excluded.userAgent, clients.userAgent),
               lastSeen = excluded.lastSeen,
               requestCount = clients.requestCount + excluded.requestCount,
               promptTokens = COALESCE(clients.promptTokens, 0) + excluded.promptTokens,
               completionTokens = COALESCE(clients.completionTokens, 0) + excluded.completionTokens,
               totalTokens = COALESCE(clients.totalTokens, 0) + excluded.totalTokens,
               tokensUsedCurrentPeriod = COALESCE(clients.tokensUsedCurrentPeriod, 0) + excluded.tokensUsedCurrentPeriod,
               updatedAt = excluded.updatedAt`,
            [
              item.ip,
              item.name || "",
              item.tool || "CLI Tool",
              item.category || "cli",
              item.userAgent || "",
              item.lastSeen || now,
              item.count || 0,
              pTok,
              cTok,
              tTok,
              tTok,
              now,
              now,
            ]
          );

          try {
            db.run(
              `INSERT INTO clientActivityTimeline(ip, minuteBucket, requestCount, promptTokens, completionTokens, totalTokens)
               VALUES(?, ?, ?, ?, ?, ?)
               ON CONFLICT(ip, minuteBucket) DO UPDATE SET
                 requestCount = clientActivityTimeline.requestCount + excluded.requestCount,
                 promptTokens = COALESCE(clientActivityTimeline.promptTokens, 0) + excluded.promptTokens,
                 completionTokens = COALESCE(clientActivityTimeline.completionTokens, 0) + excluded.completionTokens,
                 totalTokens = COALESCE(clientActivityTimeline.totalTokens, 0) + excluded.totalTokens`,
              [item.ip, minuteBucket, item.count || 0, pTok, cTok, tTok]
            );
          } catch {}
        }
      });
      syncClientsToJson().catch(() => {});
    } catch (e) {
      console.log("[clientsRepo] activity flush failed:", e.message);
    }
  }, 1000);
}

export function recordClientActivity(ip, { tool = "CLI Tool", category = "cli", userAgent = "", count = 1, promptTokens = 0, completionTokens = 0 } = {}) {
  if (!ip) return;
  const cleanIp = normalizeIp(ip);
  const now = Date.now();
  const existing = activityBuffer.get(cleanIp) || {
    ip: cleanIp,
    count: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastSeen: now,
    tool,
    category,
    userAgent,
  };

  existing.count += (count || 0);
  existing.promptTokens += (promptTokens || 0);
  existing.completionTokens += (completionTokens || 0);
  existing.lastSeen = now;
  if (tool) existing.tool = tool;
  if (category) existing.category = category;
  if (userAgent) existing.userAgent = userAgent;

  activityBuffer.set(cleanIp, existing);
  scheduleFlush();
}

export function recordClientTokens(ip, promptTokens = 0, completionTokens = 0) {
  if (!ip) return;
  const cleanIp = normalizeIp(ip);
  const now = Date.now();
  const existing = activityBuffer.get(cleanIp) || {
    ip: cleanIp,
    count: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastSeen: now,
  };

  existing.promptTokens += (promptTokens || 0);
  existing.completionTokens += (completionTokens || 0);
  existing.lastSeen = now;

  activityBuffer.set(cleanIp, existing);
  scheduleFlush();
}

/**
 * Get aggregated activity timeline for clients including tokens.
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
      requestCount INTEGER DEFAULT 0,
      promptTokens INTEGER DEFAULT 0,
      completionTokens INTEGER DEFAULT 0,
      totalTokens INTEGER DEFAULT 0
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
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      activeClients: 0,
      clientBreakdown: {},
      clientTokensBreakdown: {},
    };
  });

  let where = "WHERE minuteBucket >= ?";
  const params = [startTime];
  if (filterIp && filterIp !== "all") {
    where += " AND ip = ?";
    params.push(normalizeIp(filterIp));
  }

  const rows = db.all(
    `SELECT ip, minuteBucket, requestCount, 
            COALESCE(promptTokens, 0) as promptTokens, 
            COALESCE(completionTokens, 0) as completionTokens, 
            COALESCE(totalTokens, 0) as totalTokens 
     FROM clientActivityTimeline ${where} ORDER BY minuteBucket ASC`,
    params
  );

  for (const r of rows) {
    const ts = Number(r.minuteBucket);
    if (ts < startTime) continue;
    const idx = Math.min(Math.floor((ts - startTime) / bucketMs), bucketCount - 1);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx].requests += (r.requestCount || 0);
      buckets[idx].promptTokens += (r.promptTokens || 0);
      buckets[idx].completionTokens += (r.completionTokens || 0);
      buckets[idx].totalTokens += (r.totalTokens || (r.promptTokens + r.completionTokens) || 0);

      buckets[idx].clientBreakdown[r.ip] = (buckets[idx].clientBreakdown[r.ip] || 0) + (r.requestCount || 0);
      buckets[idx].clientTokensBreakdown[r.ip] = (buckets[idx].clientTokensBreakdown[r.ip] || 0) + (r.totalTokens || 0);
    }
  }

  // Include in-flight buffer memory
  const bufferItems = Array.from(activityBuffer.values());
  for (const item of bufferItems) {
    if (filterIp && filterIp !== "all" && item.ip !== normalizeIp(filterIp)) continue;
    const idx = Math.min(Math.floor((now - startTime) / bucketMs), bucketCount - 1);
    if (idx >= 0 && idx < bucketCount) {
      const p = item.promptTokens || 0;
      const c = item.completionTokens || 0;
      const t = p + c;
      buckets[idx].requests += (item.count || 0);
      buckets[idx].promptTokens += p;
      buckets[idx].completionTokens += c;
      buckets[idx].totalTokens += t;

      buckets[idx].clientBreakdown[item.ip] = (buckets[idx].clientBreakdown[item.ip] || 0) + (item.count || 0);
      buckets[idx].clientTokensBreakdown[item.ip] = (buckets[idx].clientTokensBreakdown[item.ip] || 0) + t;
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
