"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle, ConfirmModal, SegmentedControl } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import ClientActivityTab from "./components/ClientActivityTab";

function formatRelativeTime(ts) {
  if (!ts) return "Never";
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function formatTokens(num) {
  const n = Number(num) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function getStatusInfo(client) {
  const now = Date.now();
  const diffSec = Math.floor((now - (client.lastSeen || 0)) / 1000);
  if (client.isLive || diffSec < 60) {
    return { label: "Online", dotColor: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]", badgeVariant: "success" };
  }
  if (diffSec < 3600) {
    return { label: "Idle", dotColor: "bg-amber-500", badgeVariant: "warning" };
  }
  return { label: "Offline", dotColor: "bg-zinc-400 dark:bg-zinc-600", badgeVariant: "default" };
}

function getToolBadge(tool, category) {
  const t = String(tool || "").toLowerCase();
  if (t.includes("antigravity")) {
    return { label: "Antigravity IDE", bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30", icon: "rocket_launch" };
  }
  if (t.includes("claude")) {
    return { label: "Claude Code", bg: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30", icon: "terminal" };
  }
  if (t.includes("cline")) {
    return { label: "Cline", bg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30", icon: "code" };
  }
  if (t.includes("cursor")) {
    return { label: "Cursor", bg: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30", icon: "ads_click" };
  }
  if (t.includes("copilot")) {
    return { label: "Copilot", bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: "smart_toy" };
  }
  if (t.includes("opencode") || t.includes("openclaw")) {
    return { label: tool, bg: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30", icon: "terminal" };
  }
  if (category === "mitm") {
    return { label: tool || "MITM Tool", bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30", icon: "shield" };
  }
  return { label: tool || "CLI / API", bg: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30", icon: "lan" };
}

const TOKEN_PRESETS = [
  { label: "Unlimited", value: 0 },
  { label: "500k", value: 500000 },
  { label: "1M", value: 1000000 },
  { label: "2.5M", value: 2500000 },
  { label: "5M", value: 5000000 },
  { label: "10M", value: 10000000 },
  { label: "25M", value: 25000000 },
];

export default function ClientsPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const activeTab = tabParam === "activity" ? "activity" : "connections";

  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === "activity") {
      params.set("tab", "activity");
    } else {
      params.delete("tab");
    }
    const query = params.toString();
    router.replace(query ? `/dashboard/clients?${query}` : "/dashboard/clients", { scroll: false });
  };

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Modals
  const [editingClient, setEditingClient] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newIp, setNewIp] = useState("");
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newTokenLimit, setNewTokenLimit] = useState(0);
  const [clientToDelete, setClientToDelete] = useState(null);

  const { addNotification } = useNotificationStore();

  const fetchClients = useCallback(async (silent = false) => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
      }
    } catch (err) {
      if (!silent) {
        addNotification({ type: "error", message: `Failed to fetch client connections: ${err.message}` });
      }
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchClients(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchClients]);

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

      if (!res.ok) throw new Error("Failed to update status on server");

      addNotification({
        type: nextStatus ? "success" : "warning",
        message: nextStatus
          ? `Client ${ip} is now ACTIVE (routed via 9Router)`
          : `Client ${ip} is now DISABLED (bypassed to native default)`,
      });
    } catch (err) {
      setClients((prev) =>
        prev.map((c) => (c.ip === ip ? { ...c, enabled: currentStatus } : c))
      );
      addNotification({ type: "error", message: err.message });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingClient) return;
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: editingClient.ip,
          name: editingClient.name,
          notes: editingClient.notes,
          enabled: editingClient.enabled,
          tokenLimit: Number(editingClient.tokenLimit) || 0,
          tokenLimitPeriod: editingClient.tokenLimitPeriod || "all",
        }),
      });
      if (res.ok) {
        addNotification({ type: "success", message: `Client ${editingClient.ip} updated.` });
        setEditingClient(null);
        fetchClients(true);
      } else {
        throw new Error("Failed to save changes");
      }
    } catch (err) {
      addNotification({ type: "error", message: err.message });
    }
  };

  const handleResetUsage = async (ip) => {
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, resetUsage: true }),
      });
      if (res.ok) {
        addNotification({ type: "success", message: `Token quota usage reset for ${ip}.` });
        if (editingClient && editingClient.ip === ip) {
          setEditingClient((prev) => ({ ...prev, tokensUsedCurrentPeriod: 0 }));
        }
        fetchClients(true);
      }
    } catch (err) {
      addNotification({ type: "error", message: err.message });
    }
  };

  const handleAddClient = async () => {
    const trimmedIp = newIp.trim();
    if (!trimmedIp) return;
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: trimmedIp,
          name: newName.trim(),
          notes: newNotes.trim(),
          tokenLimit: Number(newTokenLimit) || 0,
          enabled: true,
        }),
      });
      if (res.ok) {
        addNotification({ type: "success", message: `Client IP ${trimmedIp} added.` });
        setShowAddModal(false);
        setNewIp("");
        setNewName("");
        setNewNotes("");
        setNewTokenLimit(0);
        fetchClients(true);
      } else {
        throw new Error("Failed to add client IP");
      }
    } catch (err) {
      addNotification({ type: "error", message: err.message });
    }
  };

  const handleDeleteClient = async () => {
    if (!clientToDelete) return;
    try {
      const res = await fetch(`/api/clients?ip=${encodeURIComponent(clientToDelete.ip)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        addNotification({ type: "success", message: `Client ${clientToDelete.ip} removed.` });
        setClientToDelete(null);
        fetchClients(true);
      }
    } catch (err) {
      addNotification({ type: "error", message: err.message });
    }
  };

  // Filtered clients
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        c.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.name && c.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.tool && c.tool.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;
      if (filterCategory === "mitm") return c.category === "mitm";
      if (filterCategory === "cli") return c.category !== "mitm";
      return true;
    });
  }, [clients, searchQuery, filterCategory]);

  // Statistics
  const stats = useMemo(() => {
    const total = clients.length;
    const active = clients.filter((c) => c.enabled !== false).length;
    const disabled = clients.filter((c) => c.enabled === false).length;
    const now = Date.now();
    const online = clients.filter((c) => c.isLive || now - (c.lastSeen || 0) < 60000).length;
    const totalRequests = clients.reduce((sum, c) => sum + (c.requestCount || 0), 0);
    const totalTokens = clients.reduce((sum, c) => sum + (c.totalTokens || 0), 0);
    const promptTokens = clients.reduce((sum, c) => sum + (c.promptTokens || 0), 0);
    const completionTokens = clients.reduce((sum, c) => sum + (c.completionTokens || 0), 0);
    return { total, active, disabled, online, totalRequests, totalTokens, promptTokens, completionTokens };
  }, [clients]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <SegmentedControl
          options={[
            { value: "connections", label: "Connections & Quotas", icon: "devices" },
            { value: "activity", label: "Usage & Activity Timeline", icon: "monitoring" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
      </div>

      {activeTab === "activity" ? (
        <ClientActivityTab />
      ) : (
        <>
          {/* Header Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">devices</span>
                Client Connections & Token Quota Control
              </h1>
              <p className="text-xs text-text-muted mt-1">
                Realtime tracking for Akbar Server, Meninjar, and all team endpoints across Antigravity IDE, Claude Code, and CLI tools with customizable token limits.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-1.5 text-xs ${autoRefresh ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : ""}`}
                title={autoRefresh ? "Live polling active (4s)" : "Live polling paused"}
              >
                <span className={`material-symbols-outlined text-[16px] ${autoRefresh ? "animate-spin" : ""}`}>
                  sync
                </span>
                {autoRefresh ? "Live (4s)" : "Paused"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchClients()}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Refresh
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add IP
              </Button>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card className="p-4 flex items-center justify-between border-border-subtle bg-surface-1">
              <div>
                <p className="text-xs font-medium text-text-muted">Total Clients</p>
                <p className="text-2xl font-bold text-text-main mt-1">{stats.total}</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">{stats.online} online now</p>
              </div>
              <div className="size-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">devices</span>
              </div>
            </Card>

            <Card className="p-4 flex items-center justify-between border-border-subtle bg-surface-1">
              <div>
                <p className="text-xs font-medium text-text-muted">Total Requests</p>
                <p className="text-2xl font-bold text-text-main mt-1">{stats.totalRequests.toLocaleString()}</p>
                <p className="text-[11px] text-text-muted mt-0.5">lifetime calls</p>
              </div>
              <div className="size-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">analytics</span>
              </div>
            </Card>

            <Card className="p-4 flex items-center justify-between border-border-subtle bg-surface-1">
              <div>
                <p className="text-xs font-medium text-text-muted">Total Tokens</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatTokens(stats.totalTokens)}</p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {formatTokens(stats.promptTokens)} in / {formatTokens(stats.completionTokens)} out
                </p>
              </div>
              <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">token</span>
              </div>
            </Card>

            <Card className="p-4 flex items-center justify-between border-border-subtle bg-surface-1">
              <div>
                <p className="text-xs font-medium text-text-muted">Routing Control</p>
                <p className="text-2xl font-bold text-text-main mt-1">{stats.active} <span className="text-xs font-normal text-text-muted">/ {stats.total} Active</span></p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">{stats.disabled} disabled / bypass</p>
              </div>
              <div className="size-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">tune</span>
              </div>
            </Card>
          </div>

          {/* Main Table Card */}
          <Card className="p-0 border-border-subtle bg-surface-1 overflow-hidden">
            {/* Filter Toolbar */}
            <div className="p-4 border-b border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-2/30">
              <div className="relative w-full sm:w-72">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-text-muted">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search IP, name, tool..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border-subtle bg-surface-1 text-text-main focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center p-0.5 rounded-lg border border-border-subtle bg-surface-1">
                  <button
                    type="button"
                    onClick={() => setFilterCategory("all")}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      filterCategory === "all" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    All ({clients.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterCategory("mitm")}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      filterCategory === "mitm" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    MITM ({clients.filter((c) => c.category === "mitm").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterCategory("cli")}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      filterCategory === "cli" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    CLI ({clients.filter((c) => c.category !== "mitm").length})
                  </button>
                </div>
              </div>
            </div>

            {/* Table Content */}
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-2/50 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Client IP</th>
                    <th className="py-3 px-4">Alias / Machine</th>
                    <th className="py-3 px-4">Tool</th>
                    <th className="py-3 px-4 text-center">Requests</th>
                    <th className="py-3 px-4">Tokens (In / Out / Total)</th>
                    <th className="py-3 px-4">Token Quota & Limit</th>
                    <th className="py-3 px-4">Last Seen</th>
                    <th className="py-3 px-4 text-center">Routing</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-xs">
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-text-muted">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <span className="material-symbols-outlined text-[36px] opacity-40">devices_off</span>
                          <p className="font-medium">No client connections found</p>
                          <p className="text-[11px]">
                            Connect Akbar Server (10.10.123.139) or Antigravity IDE to see activity.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredClients.map((client) => {
                      const status = getStatusInfo(client);
                      const toolBadge = getToolBadge(client.tool, client.category);
                      const isEnabled = client.enabled !== false;
                      const tokenLimit = Number(client.tokenLimit) || 0;
                      const usedTokens = Number(client.tokensUsedCurrentPeriod || client.totalTokens || 0);
                      const percentUsed = tokenLimit > 0 ? Math.min(100, Math.round((usedTokens / tokenLimit) * 100)) : 0;
                      const isExceeded = tokenLimit > 0 && usedTokens >= tokenLimit;

                      return (
                        <tr
                          key={client.ip}
                          className={`hover:bg-surface-2/30 transition-colors ${
                            !isEnabled ? "opacity-60 bg-surface-2/10" : ""
                          }`}
                        >
                          {/* Status */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${status.dotColor}`} />
                              <span className="text-[11px] font-medium text-text-muted">
                                {status.label}
                              </span>
                            </div>
                          </td>

                          {/* Client IP */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-mono text-text-main font-medium">
                              <span>{client.ip}</span>
                              {client.ip === "127.0.0.1" && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-zinc-500/10 text-zinc-500 border border-zinc-500/20 font-sans">
                                  Local
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Device Alias */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {client.name ? (
                                <span className="font-semibold text-text-main">{client.name}</span>
                              ) : (
                                <span className="text-text-muted italic text-[11px]">— No Alias —</span>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingClient({ ...client })}
                                className="text-text-muted hover:text-primary transition-opacity"
                                title="Edit Alias & Limit"
                              >
                                <span className="material-symbols-outlined text-[14px]">edit</span>
                              </button>
                            </div>
                            {client.notes && (
                              <p className="text-[10px] text-text-muted truncate max-w-xs">{client.notes}</p>
                            )}
                          </td>

                          {/* Tool Badge */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${toolBadge.bg}`}
                            >
                              <span className="material-symbols-outlined text-[13px]">{toolBadge.icon}</span>
                              {toolBadge.label}
                            </span>
                          </td>

                          {/* Request Count */}
                          <td className="py-3 px-4 whitespace-nowrap text-center font-mono text-[11px] text-text-muted">
                            {(client.requestCount || 0).toLocaleString()}
                          </td>

                          {/* Token Usage Breakdown */}
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                            <div className="flex flex-col">
                              <span className="font-bold text-text-main">{formatTokens(client.totalTokens || 0)}</span>
                              <span className="text-[10px] text-text-muted">
                                <span className="text-emerald-500">{formatTokens(client.promptTokens || 0)}</span>
                                {" / "}
                                <span className="text-blue-500">{formatTokens(client.completionTokens || 0)}</span>
                              </span>
                            </div>
                          </td>

                          {/* Token Quota & Limit */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {tokenLimit === 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                <span className="material-symbols-outlined text-[12px]">all_inclusive</span>
                                Unlimited
                              </span>
                            ) : (
                              <div className="w-36 space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span className={isExceeded ? "text-red-500 font-bold" : "text-text-muted"}>
                                    {formatTokens(usedTokens)} / {formatTokens(tokenLimit)}
                                  </span>
                                  <span className={`font-semibold ${isExceeded ? "text-red-500" : percentUsed > 80 ? "text-amber-500" : "text-text-muted"}`}>
                                    {percentUsed}%
                                  </span>
                                </div>
                                <div className="w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      isExceeded
                                        ? "bg-red-500"
                                        : percentUsed > 80
                                        ? "bg-amber-500"
                                        : "bg-emerald-500"
                                    }`}
                                    style={{ width: `${percentUsed}%` }}
                                  />
                                </div>
                                <div className="flex items-center justify-between text-[9px] text-text-muted uppercase">
                                  <span>{client.tokenLimitPeriod || "all"}</span>
                                  {isExceeded && (
                                    <span className="text-red-500 font-bold">BLOCKED</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Last Seen */}
                          <td className="py-3 px-4 whitespace-nowrap text-[11px] text-text-muted">
                            {formatRelativeTime(client.lastSeen)}
                          </td>

                          {/* Routing Toggle */}
                          <td className="py-3 px-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Toggle
                                checked={isEnabled}
                                onChange={() => handleToggle(client.ip, isEnabled)}
                              />
                              <span
                                className={`text-[11px] font-semibold min-w-[36px] text-left ${
                                  isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"
                                }`}
                              >
                                {isEnabled ? "ON" : "OFF"}
                              </span>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingClient({ ...client })}
                                className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors"
                                title="Edit Alias & Token Limit"
                              >
                                <span className="material-symbols-outlined text-[16px]">tune</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResetUsage(client.ip)}
                                className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-amber-500 transition-colors"
                                title="Reset Token Quota"
                              >
                                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setClientToDelete(client)}
                                className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                title="Delete Client Record"
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Info Card */}
          <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 flex items-start gap-3">
            <span className="material-symbols-outlined text-blue-500 text-[20px] shrink-0 mt-0.5">shield</span>
            <div className="text-xs text-text-main space-y-1">
              <p className="font-semibold text-blue-600 dark:text-blue-400">Monitoring & Token Quota Control:</p>
              <p className="text-text-muted leading-relaxed">
                • <strong>Client Identification</strong>: Setiap komputer/server (seperti <code>Akbar Server: 10.10.123.139</code> dan <code>Meninjar: 10.10.123.147</code>) teridentifikasi secara terpisah via IP header spoof-safe.<br />
                • <strong>Token Limit Enforced</strong>: Jika batas token tercapai, client otomatis diblokir dengan status HTTP 403 kuota habis hingga counter di-reset atau periode berganti (Daily/Monthly).
              </p>
            </div>
          </div>

          {/* Modal: Edit Client & Token Limit */}
          {editingClient && (
            <Modal
              isOpen={true}
              onClose={() => setEditingClient(null)}
              title={`Client Settings: ${editingClient.ip}`}
            >
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Device Alias / Computer Name</label>
                  <Input
                    value={editingClient.name || ""}
                    onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })}
                    placeholder="e.g. Akbar Server / Workstation Meninjar"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Notes / Description</label>
                  <Input
                    value={editingClient.notes || ""}
                    onChange={(e) => setEditingClient({ ...editingClient, notes: e.target.value })}
                    placeholder="e.g. Developer server, Antigravity IDE"
                  />
                </div>

                {/* Token Limit Section */}
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-2/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-primary">token</span>
                        Token Quota Limit
                      </p>
                      <p className="text-[11px] text-text-muted">Set maximum tokens this client can consume (0 = unlimited)</p>
                    </div>
                    {Number(editingClient.tokenLimit) > 0 && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleResetUsage(editingClient.ip)}
                        className="text-amber-500 border-amber-500/30"
                      >
                        Reset Used
                      </Button>
                    )}
                  </div>

                  {/* Preset Buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {TOKEN_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setEditingClient({ ...editingClient, tokenLimit: p.value })}
                        className={`px-2.5 py-1 text-[11px] rounded font-medium border transition-colors ${
                          Number(editingClient.tokenLimit) === p.value
                            ? "bg-primary text-white border-primary"
                            : "bg-surface-1 text-text-muted hover:text-text-main border-border-subtle"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[11px] text-text-muted mb-1 block">Custom Limit (Tokens)</label>
                      <Input
                        type="number"
                        value={editingClient.tokenLimit ?? 0}
                        onChange={(e) => setEditingClient({ ...editingClient, tokenLimit: Math.max(0, parseInt(e.target.value) || 0) })}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-muted mb-1 block">Reset Period</label>
                      <select
                        value={editingClient.tokenLimitPeriod || "all"}
                        onChange={(e) => setEditingClient({ ...editingClient, tokenLimitPeriod: e.target.value })}
                        className="w-full h-9 px-2 text-xs rounded-lg border border-border-subtle bg-surface-1 text-text-main focus:outline-none focus:border-primary"
                      >
                        <option value="all">Lifetime (No Auto-Reset)</option>
                        <option value="daily">Daily (Resets midnight)</option>
                        <option value="monthly">Monthly (Resets 1st of month)</option>
                      </select>
                    </div>
                  </div>

                  {Number(editingClient.tokenLimit) > 0 && (
                    <div className="text-[11px] text-text-muted pt-1 flex items-center justify-between">
                      <span>Currently used this period:</span>
                      <span className="font-mono font-bold text-text-main">
                        {(editingClient.tokensUsedCurrentPeriod || editingClient.totalTokens || 0).toLocaleString()} tokens
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border-subtle bg-surface-2/40">
                  <div>
                    <p className="text-xs font-semibold text-text-main">9Router Connection Status</p>
                    <p className="text-[11px] text-text-muted">Disable to bypass directly to default native upstream</p>
                  </div>
                  <Toggle
                    checked={editingClient.enabled !== false}
                    onChange={() => setEditingClient({ ...editingClient, enabled: !editingClient.enabled })}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
                  <Button variant="outline" size="sm" onClick={() => setEditingClient(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveEdit}>
                    Save Settings
                  </Button>
                </div>
              </div>
            </Modal>
          )}

          {/* Modal: Add Client IP */}
          {showAddModal && (
            <Modal
              isOpen={true}
              onClose={() => setShowAddModal(false)}
              title="Add Client IP to Monitor"
            >
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Client IP Address *</label>
                  <Input
                    value={newIp}
                    onChange={(e) => setNewIp(e.target.value)}
                    placeholder="e.g. 10.10.123.139"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Device Alias / Computer Name</label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Akbar Server"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Token Limit (0 = Unlimited)</label>
                  <Input
                    type="number"
                    value={newTokenLimit}
                    onChange={(e) => setNewTokenLimit(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-main mb-1 block">Notes / Description</label>
                  <Input
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="e.g. Developer machine"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
                  <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleAddClient} disabled={!newIp.trim()}>
                    Add Client
                  </Button>
                </div>
              </div>
            </Modal>
          )}

          {/* Modal: Delete Confirmation */}
          {clientToDelete && (
            <ConfirmModal
              isOpen={true}
              onClose={() => setClientToDelete(null)}
              onConfirm={handleDeleteClient}
              title="Delete Client Record"
              message={`Are you sure you want to remove client ${clientToDelete.ip} (${clientToDelete.name || "No alias"})? If the device reconnects, it will re-appear automatically.`}
              confirmText="Delete Client"
              confirmVariant="danger"
            />
          )}
        </>
      )}
    </div>
  );
}
