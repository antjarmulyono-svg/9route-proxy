"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CardSkeleton } from "@/shared/components";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { MitmLinkCard, CliClientConnectionsCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";
import { useNotificationStore } from "@/store/notificationStore";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

function getToolIdForClient(client) {
  if (!client) return null;
  const tool = (client.tool || "").toLowerCase();
  const ua = (client.userAgent || "").toLowerCase();
  const name = (client.name || "").toLowerCase();

  if (tool.includes("claude") || ua.includes("claude") || name.includes("claude")) return "claude";
  if (tool.includes("open claw") || ua.includes("openclaw") || name.includes("openclaw")) return "openclaw";
  if (tool.includes("codex") || ua.includes("codex") || name.includes("codex")) return "codex";
  if (tool.includes("opencode") || ua.includes("opencode") || name.includes("opencode")) return "opencode";
  if (tool.includes("cowork") || ua.includes("cowork") || name.includes("cowork")) return "cowork";
  if (tool.includes("hermes") || ua.includes("hermes") || name.includes("hermes")) return "hermes";
  if (tool.includes("droid") || ua.includes("droid") || name.includes("droid")) return "droid";
  if (tool.includes("kilo") || ua.includes("kilo") || name.includes("kilo")) return "kilo";
  if (tool.includes("roo") || ua.includes("roo") || name.includes("roo")) return "roo";
  if (tool.includes("continue") || ua.includes("continue") || name.includes("continue")) return "continue";
  if (tool.includes("cline") || ua.includes("cline") || name.includes("cline")) return "cline";
  if (tool.includes("deepseek") || ua.includes("deepseek") || name.includes("deepseek")) return "deepseek-tui";
  if (tool.includes("grok") || ua.includes("grok") || name.includes("grok")) return "grok-build";
  if (tool.includes("jcode") || ua.includes("jcode") || name.includes("jcode")) return "jcode";
  if (tool.includes("amp") || ua.includes("amp") || name.includes("amp")) return "amp";
  if (tool.includes("qwen") || ua.includes("qwen") || name.includes("qwen")) return "qwen";
  if (tool.includes("devin") || ua.includes("devin") || name.includes("devin")) return "devin";
  if (tool.includes("opendesign") || ua.includes("opendesign") || name.includes("opendesign")) return "opendesign";
  if (tool.includes("cursor") || ua.includes("cursor") || name.includes("cursor")) return "cursor";
  if (tool.includes("copilot") || ua.includes("copilot") || name.includes("copilot")) return "copilot";
  if (tool.includes("antigravity") || name.includes("antigravity")) return "antigravity";
  if (tool.includes("ai-sdk") || ua.includes("ai-sdk") || name.includes("ai-sdk") || name.includes("openai")) return "ai-sdk";
  return null;
}


export default function CLIToolsPageClient({ machineId }) {
  const [loading, setLoading] = useState(true);
  const [toolStatuses, setToolStatuses] = useState({});
  const [clients, setClients] = useState([]);
  const { addNotification } = useNotificationStore();

  const knownIpsRef = useRef(new Set());
  const initialClientsLoadedRef = useRef(false);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        const incoming = data.clients || [];

        // Notify if new client appears after initial load
        if (initialClientsLoadedRef.current) {
          for (const c of incoming) {
            if (!knownIpsRef.current.has(c.ip) && c.ip !== "127.0.0.1") {
              addNotification({
                type: "info",
                message: `Client connected: ${c.ip}${c.name ? ` (${c.name})` : ""} via ${c.tool || "CLI"}`,
              });
            }
          }
        }

        incoming.forEach((c) => knownIpsRef.current.add(c.ip));
        initialClientsLoadedRef.current = true;
        setClients(incoming);
      }
    } catch (e) {
      console.log("Error fetching clients in CLITools:", e);
    }
  }, [addNotification]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [statusRes] = await Promise.allSettled([
          fetch(ALL_STATUSES_URL).then((r) => (r.ok ? r.json() : {})),
          fetchClients(),
        ]);
        if (mounted && statusRes.status === "fulfilled") {
          setToolStatuses(statusRes.value || {});
        }
      } catch (error) {
        console.log("Error fetching tool statuses:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const interval = setInterval(fetchClients, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchClients]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const clientsByToolId = {};
  for (const client of clients) {
    const tid = getToolIdForClient(client);
    if (tid) {
      if (!clientsByToolId[tid]) clientsByToolId[tid] = [];
      clientsByToolId[tid].push(client);
    }
  }

  const regularTools = Object.entries(CLI_TOOLS);
  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <CliClientConnectionsCard
        clients={clients}
        onToggleSuccess={(ip, nextStatus) => {
          setClients((prev) =>
            prev.map((c) => (c.ip === ip ? { ...c, enabled: nextStatus } : c))
          );
        }}
      />

      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">terminal</span>
            <h2 className="text-sm font-semibold text-text-main">CLI Tools</h2>
          </div>
          <span className="text-xs text-text-muted">{regularTools.length} tools available</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {regularTools.map(([toolId, tool]) => (
            <ToolSummaryCard
              key={toolId}
              toolId={toolId}
              tool={tool}
              status={toolStatuses[toolId]}
              connectedClients={clientsByToolId[toolId] || []}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-[18px] text-primary">security</span>
          <h2 className="text-sm font-semibold text-text-main">MITM Tools</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {mitmTools.map(([toolId, tool]) => (
            <MitmLinkCard key={toolId} tool={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
