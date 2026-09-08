"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/shared/components";

// Derive simple connected/configured/not-installed status from API payload or remote client connections
function getStatus(status, connectedClients = []) {
  if (connectedClients && connectedClients.length > 0) {
    const isLive = connectedClients.some((c) => c.isLive);
    const count = connectedClients.length;
    const client = connectedClients[0];
    const clientDesc = count === 1 ? (client.name || client.ip) : `${count} clients`;
    return {
      label: `Connected (${clientDesc})`,
      cls: isLive
        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      active: isLive,
      hasClients: true,
    };
  }
  if (status?.has9Router) {
    return { label: "Connected (local)", cls: "bg-green-500/10 text-green-600 dark:text-green-400" };
  }
  if (status?.installed) {
    return { label: "Installed (local)", cls: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" };
  }
  return { label: "Ready to Connect", cls: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20" };
}


export default function ToolSummaryCard({ toolId, tool, status, connectedClients = [] }) {
  const s = getStatus(status, connectedClients);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block">
      <Card padding="sm" className="h-full overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="size-8 flex items-center justify-center shrink-0">
              {tool.image ? (
                <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
              ) : tool.icon ? (
                <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }}>{tool.icon}</span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{tool.name}</h3>
              <span className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${s.cls}`}>
                {s.active ? (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                ) : s.hasClients ? (
                  <span className="size-1.5 rounded-full bg-emerald-500/60 inline-block"></span>
                ) : null}
                <span className="truncate">{s.label}</span>
              </span>
            </div>
            <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

