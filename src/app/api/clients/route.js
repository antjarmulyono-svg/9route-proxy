import { NextResponse } from "next/server";
import https from "https";
import { getAllClients, getClientByIp, upsertClient, deleteClient } from "@/lib/db/repos/clientsRepo.js";
import { syncClientsToJson } from "@/lib/mitmClientCache.js";

async function fetchMitmActiveClients() {
  return new Promise((resolve) => {
    const req = https.get(
      "https://127.0.0.1/_mitm_clients",
      { rejectUnauthorized: false, timeout: 1000 },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            resolve(data.clients || {});
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on("error", () => resolve({}));
    req.on("timeout", () => {
      req.destroy();
      resolve({});
    });
  });
}

// GET - List all clients with merged live stats
export async function GET() {
  try {
    const dbClients = await getAllClients();
    const liveMitmClients = await fetchMitmActiveClients();

    const now = Date.now();
    const clientMap = new Map();
    for (const c of dbClients) {
      const isLive = now - (c.lastSeen || 0) < 60000;
      clientMap.set(c.ip, { ...c, isLive });
    }

    for (const [ip, liveData] of Object.entries(liveMitmClients)) {
      const existing = clientMap.get(ip);
      const isLive = now - (liveData.lastSeen || 0) < 60000; // seen within 60s
      if (existing) {
        existing.isLive = isLive;
        existing.lastSeen = Math.max(existing.lastSeen || 0, liveData.lastSeen || 0);
        existing.tool = liveData.tool ? `${liveData.tool.toUpperCase()} (MITM)` : existing.tool;
        existing.category = "mitm";
      } else {
        clientMap.set(ip, {
          ip,
          name: "",
          enabled: true,
          tool: liveData.tool ? `${liveData.tool.toUpperCase()} (MITM)` : "MITM Tool",
          category: "mitm",
          userAgent: "",
          lastSeen: liveData.lastSeen || now,
          requestCount: liveData.count || 1,
          notes: "",
          isLive,
          createdAt: liveData.firstSeen || now,
          updatedAt: now,
        });
      }
    }

    const clients = Array.from(clientMap.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    return NextResponse.json({ ok: true, clients });
  } catch (error) {
    console.error("[api/clients] GET error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// POST - Create or update client details
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || !body.ip) {
      return NextResponse.json({ ok: false, error: "IP address is required" }, { status: 400 });
    }

    const saved = await upsertClient(body);
    await syncClientsToJson();
    return NextResponse.json({ ok: true, client: saved });
  } catch (error) {
    console.error("[api/clients] POST error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// DELETE - Remove client rule
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ip = searchParams.get("ip");
    if (!ip) {
      return NextResponse.json({ ok: false, error: "IP address is required" }, { status: 400 });
    }

    const deleted = await deleteClient(ip);
    await syncClientsToJson();
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("[api/clients] DELETE error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
