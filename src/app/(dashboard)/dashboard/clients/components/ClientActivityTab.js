"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, Button, SegmentedControl } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const PERIODS = [
  { value: "1h", label: "1 Hour" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
];

function formatTokens(num) {
  const n = Number(num) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export default function ClientActivityTab() {
  const [period, setPeriod] = useState("24h");
  const [selectedIp, setSelectedIp] = useState("all");
  const [viewMetric, setViewMetric] = useState("tokens"); // 'tokens' or 'requests'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/clients/activity-stats?period=${period}&ip=${encodeURIComponent(selectedIp)}`);
        if (res.ok && active) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        if (active) {
          addNotification({ type: "error", message: `Failed to load client activity stats: ${e.message}` });
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [period, selectedIp, addNotification]);

  const fetchSilent = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/activity-stats?period=${period}&ip=${encodeURIComponent(selectedIp)}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {}
  }, [period, selectedIp]);

  // Polling interval 5s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSilent();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSilent]);

  const chartData = useMemo(() => {
    if (!data?.stats?.buckets) return [];
    return data.stats.buckets.map((b) => ({
      label: b.label,
      requests: b.requests || 0,
      promptTokens: b.promptTokens || 0,
      completionTokens: b.completionTokens || 0,
      totalTokens: b.totalTokens || ((b.promptTokens || 0) + (b.completionTokens || 0)),
      activeClients: b.activeClients || 0,
    }));
  }, [data]);

  const totalPeriodRequests = useMemo(() => {
    return chartData.reduce((acc, cur) => acc + (cur.requests || 0), 0);
  }, [chartData]);

  const totalPromptTokens = useMemo(() => {
    return chartData.reduce((acc, cur) => acc + (cur.promptTokens || 0), 0);
  }, [chartData]);

  const totalCompletionTokens = useMemo(() => {
    return chartData.reduce((acc, cur) => acc + (cur.completionTokens || 0), 0);
  }, [chartData]);

  const totalTokens = useMemo(() => {
    return totalPromptTokens + totalCompletionTokens;
  }, [totalPromptTokens, totalCompletionTokens]);

  const maxRequests = useMemo(() => {
    return Math.max(0, ...chartData.map((d) => d.requests));
  }, [chartData]);

  const maxTokens = useMemo(() => {
    return Math.max(0, ...chartData.map((d) => d.totalTokens));
  }, [chartData]);

  const clientsList = data?.clients || [];

  return (
    <div className="flex flex-col gap-6">
      {/* Top Filter and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-1 p-3.5 rounded-xl border border-border-subtle">
        <div className="flex flex-wrap items-center gap-3">
          {/* Client Filter Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">devices</span>
              Client:
            </span>
            <select
              value={selectedIp}
              onChange={(e) => setSelectedIp(e.target.value)}
              className="bg-surface-2 text-text-main text-xs rounded-lg px-2.5 py-1.5 border border-border-subtle focus:outline-none focus:border-primary font-medium"
            >
              <option value="all">All Clients (Aggregate)</option>
              {clientsList.map((c) => (
                <option key={c.ip} value={c.ip}>
                  {c.name ? `${c.name} (${c.ip})` : c.ip}
                </option>
              ))}
            </select>
          </div>

          {/* Metric View Toggle */}
          <div className="flex items-center gap-1 bg-surface-2 p-0.5 rounded-lg border border-border-subtle">
            <button
              onClick={() => setViewMetric("tokens")}
              className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 transition-colors ${
                viewMetric === "tokens"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">token</span>
              Token Consumption
            </button>
            <button
              onClick={() => setViewMetric("requests")}
              className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 transition-colors ${
                viewMetric === "requests"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">analytics</span>
              Request Volume
            </button>
          </div>

          {/* Period Selection */}
          <div className="flex items-center gap-1 bg-surface-2 p-0.5 rounded-lg border border-border-subtle">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  period === p.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchSilent().finally(() => setLoading(false));
            }}
            className="flex items-center gap-1 text-xs"
          >
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            Refresh
          </Button>
        </div>
      </div>

      {/* Metric Cards for this period */}
      {viewMetric === "tokens" ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Total Tokens ({period})</p>
              <p className="text-2xl font-bold text-emerald-500 mt-1">{formatTokens(totalTokens)}</p>
              <p className="text-[11px] text-text-muted mt-0.5">{totalTokens.toLocaleString()} tokens</p>
            </div>
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">token</span>
            </div>
          </Card>

          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Prompt / Input Tokens</p>
              <p className="text-2xl font-bold text-text-main mt-1">{formatTokens(totalPromptTokens)}</p>
              <p className="text-[11px] text-text-muted mt-0.5">{totalTokens ? Math.round((totalPromptTokens / totalTokens) * 100) : 0}% of total</p>
            </div>
            <div className="size-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">input</span>
            </div>
          </Card>

          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Completion / Output Tokens</p>
              <p className="text-2xl font-bold text-blue-500 mt-1">{formatTokens(totalCompletionTokens)}</p>
              <p className="text-[11px] text-text-muted mt-0.5">{totalTokens ? Math.round((totalCompletionTokens / totalTokens) * 100) : 0}% of total</p>
            </div>
            <div className="size-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">output</span>
            </div>
          </Card>

          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Peak Token Bucket</p>
              <p className="text-2xl font-bold text-amber-500 mt-1">{formatTokens(maxTokens)}</p>
              <p className="text-[11px] text-text-muted mt-0.5">highest single bucket</p>
            </div>
            <div className="size-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">trending_up</span>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Total Requests ({period})</p>
              <p className="text-2xl font-bold text-text-main mt-1">{totalPeriodRequests.toLocaleString()}</p>
            </div>
            <div className="size-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">ssid_chart</span>
            </div>
          </Card>

          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Peak Activity Spike</p>
              <p className="text-2xl font-bold text-amber-500 mt-1">{maxRequests.toLocaleString()} reqs</p>
            </div>
            <div className="size-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">trending_up</span>
            </div>
          </Card>

          <Card className="p-4 border-border-subtle bg-surface-1 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-text-muted">Connected Machines</p>
              <p className="text-2xl font-bold text-emerald-500 mt-1">{clientsList.length}</p>
            </div>
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">lan</span>
            </div>
          </Card>
        </div>
      )}

      {/* Main Interactive Chart */}
      <Card className="p-4 border-border-subtle bg-surface-1 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">
                {viewMetric === "tokens" ? "token" : "area_chart"}
              </span>
              {viewMetric === "tokens" ? "Token Consumption Timeline" : "Traffic & Activity Trend"} (
              {selectedIp === "all" ? "All Connected Clients" : selectedIp})
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {viewMetric === "tokens"
                ? "Breakdown per-bucket input (prompt) vs output (completion) tokens secara realtime."
                : "Visualisasi naik turun volume request secara aktif berdasarkan interval waktu."}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center text-text-muted text-xs">
            Loading chart data...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-text-muted text-xs">
            No activity recorded for this period.
          </div>
        ) : (
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              {viewMetric === "tokens" ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="promptColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="completionColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatTokens}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(24, 24, 27, 0.95)",
                      borderColor: "rgba(63, 63, 70, 0.4)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                    formatter={(val, name) => [
                      formatTokens(val) + " tokens",
                      name === "promptTokens" ? "Prompt / Input" : name === "completionTokens" ? "Completion / Output" : "Total Tokens",
                    ]}
                    labelStyle={{ color: "#a1a1aa", fontWeight: 600, marginBottom: "4px" }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
                  />
                  <Area
                    type="monotone"
                    name="Prompt (Input)"
                    dataKey="promptTokens"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#promptColor)"
                    stackId="1"
                  />
                  <Area
                    type="monotone"
                    name="Completion (Output)"
                    dataKey="completionTokens"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#completionColor)"
                    stackId="1"
                  />
                </AreaChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="clientTraffic" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(24, 24, 27, 0.95)",
                      borderColor: "rgba(63, 63, 70, 0.4)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                    itemStyle={{ color: "#60a5fa" }}
                    labelStyle={{ color: "#a1a1aa", fontWeight: 600, marginBottom: "4px" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    name="Requests"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#clientTraffic)"
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
