"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, Toggle, Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

export default function MitmClientConnectionsCard() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const { addNotification } = useNotificationStore();

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
    const interval = setInterval(fetchClients, 5000);
    return () => clearInterval(interval);
  }, [fetchClients]);

  const handleToggle = async (ip, currentStatus) => {
    const nextStatus = !currentStatus;
    try {
      setClients((prev) =>
        prev.map((c) => (c.ip === ip ? { ...c, enabled: nextStatus } : c))
      );

      const res = await fetch("/api/clients/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, enabled: nextStatus }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      addNotification({
        type: nextStatus ? "success" : "warning",
        message: nextStatus
          ? `Client ${ip} is now ACTIVE (routed via 9Router)`
          : `Client ${ip} is now DISABLED (bypassed to native default upstream)`,
      });
    } catch (err) {
      setClients((prev) =>
        prev.map((c) => (c.ip === ip ? { ...c, enabled: currentStatus } : c))
      );
      addNotification({ type: "error", message: err.message });
    }
  };

  // Filter only MITM or clients seen
  const mitmClients = clients.filter(
    (c) => c.category === "mitm" || String(c.tool || "").toLowerCase().includes("antigravity") || c.ip !== "127.0.0.1"
  );

  return (
    <Card className="p-4 border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">lan</span>
          <div>
            <h3 className="text-sm font-semibold text-text-main">Connected Client IPs (MITM & Remote)</h3>
            <p className="text-[11px] text-text-muted">
              Toggle 9Router routing on/off per client machine. When OFF, traffic bypasses to default official upstream.
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/clients"
          className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
        >
          View All Connections
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="py-4 text-center text-xs text-text-muted">Loading client connections...</div>
        ) : mitmClients.length === 0 ? (
          <div className="py-5 text-center text-text-muted flex flex-col items-center gap-1">
            <span className="material-symbols-outlined text-[24px] opacity-40">devices_other</span>
            <p className="text-xs">No remote client IP connected yet.</p>
            <p className="text-[11px] opacity-70">
              Run <code>setup-antigravity-client.sh</code> on client machine (e.g. <code>10.10.123.147</code>) to connect.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {mitmClients.map((client) => {
              const isEnabled = client.enabled !== false;
              const now = Date.now();
              const isOnline = client.isLive || now - (client.lastSeen || 0) < 60000;

              return (
                <div key={client.ip} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`size-2 rounded-full ${
                        isOnline ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-zinc-400"
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-text-main">{client.ip}</span>
                        {client.name && (
                          <span className="text-xs text-text-muted">({client.name})</span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/10 text-primary font-medium">
                          {client.tool || "Antigravity"}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        Requests: {client.requestCount || 0} • Status: {isOnline ? "Online" : "Idle"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className={`text-[11px] font-semibold ${isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"}`}>
                      {isEnabled ? "ROUTED (ON)" : "DEFAULT (OFF)"}
                    </span>
                    <Toggle
                      checked={isEnabled}
                      onChange={() => handleToggle(client.ip, isEnabled)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
