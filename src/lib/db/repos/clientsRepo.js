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
