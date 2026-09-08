"use client";

import Link from "next/link";
import { Card, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function formatTime(timestamp) {
  if (!timestamp) return "Never";
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "Unknown";
  }
}

export default function CliClientConnectionsCard({ clients = [], onToggleSuccess }) {
  const { addNotification } = useNotificationStore();

  const handleToggle = async (ip, currentStatus) => {
    const nextStatus = !currentStatus;
    try {
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
          : `Client ${ip} is now DISABLED (blocked in 9Router)`,
      });

      if (typeof onToggleSuccess === "function") {
        onToggleSuccess(ip, nextStatus);
      }
    } catch (err) {
      addNotification({ type: "error", message: err.message });
    }
  };

  // Filter CLI clients or non-localhost clients
  const cliClients = clients.filter(
    (c) => c.category === "cli" || (c.category !== "mitm" && c.ip !== "127.0.0.1")
  );

  return (
    <Card className="p-4 border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">terminal</span>
          <div>
            <h3 className="text-sm font-semibold text-text-main">Connected CLI & Gateway Clients</h3>
            <p className="text-[11px] text-text-muted">
              Live IP connections from CLI tools (Claude Code, Cline, Roo, OpenCode, AI SDK). Toggle ON to route via 9Router or OFF to disable client.
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/clients"
          className="text-xs text-primary hover:underline flex items-center gap-1 font-medium shrink-0"
        >
          View All Clients
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>

      <div className="mt-3">
        {cliClients.length === 0 ? (
          <div className="py-5 text-center text-text-muted flex flex-col items-center gap-1">
            <span className="material-symbols-outlined text-[24px] opacity-40">terminal</span>
            <p className="text-xs font-medium">No remote CLI clients connected yet.</p>
            <p className="text-[11px] opacity-70 max-w-md">
              Point your CLI tools (Claude Code, Cline, OpenCode, AI SDK) to <code>http://&lt;server-ip&gt;:20128/v1</code>. Incoming requests will be detected and monitored here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {cliClients.map((client) => {
              const isEnabled = client.enabled !== false;
              const isOnline = Boolean(client.isLive);

              return (
                <div key={client.ip} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        isOnline ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-zinc-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-text-main">{client.ip}</span>
                        {client.name && (
                          <span className="text-xs text-text-muted font-medium">({client.name})</span>
                        )}
                        <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                          {client.tool || "CLI Tool"}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        Requests: {client.requestCount || 0} • Status:{" "}
                        <span className={isOnline ? "text-emerald-500 font-medium" : "text-text-muted"}>
                          {isOnline ? "Online" : "Idle"}
                        </span>
                        {" "}• Last active: {formatTime(client.lastSeen)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`text-[11px] font-semibold ${isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"}`}>
                      {isEnabled ? "ROUTED (ON)" : "DISABLED (OFF)"}
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
