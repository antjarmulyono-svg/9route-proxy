"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Toggle, Tooltip } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import CooldownTimer from "./CooldownTimer";

function formatErrorString(errStr) {
  if (!errStr) return "";
  try {
    const match = String(errStr).match(/^(\[\d+\]:\s*)(.*)/s);
    if (match) {
      const prefix = match[1];
      const jsonBody = match[2];
      try {
        const parsed = JSON.parse(jsonBody);
        return `${prefix}\n${JSON.stringify(parsed, null, 2)}`;
      } catch {
        return errStr;
      }
    }
    const parsed = JSON.parse(errStr);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return errStr;
  }
}

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired → treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  const activeErrorText = (connection.isActive !== false && connection.lastError) || oneByOneStatus?.error || null;

  return (
    <div className={`group flex min-w-0 flex-col gap-2 rounded-lg p-2.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
          {/* Priority arrows */}
          <div className="flex shrink-0 flex-col">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
            >
              <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
            >
              <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
            </button>
          </div>
          <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
            {authIcon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            {secondaryDisplayName && (
              <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
            )}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              <Badge variant={getStatusVariant()} size="sm" dot>
                {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
              </Badge>
              <Badge variant="default" size="sm">
                {authLabel}
              </Badge>
              {hasAnyProxy && (
                <Badge variant={proxyBadgeVariant} size="sm">
                  Proxy
                </Badge>
              )}
              {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
              {activeErrorText && (
                <button
                  type="button"
                  onClick={() => setShowErrorDetails((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer border border-red-500/20"
                  title="Click to toggle full error details"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {showErrorDetails ? "expand_less" : "warning"}
                  </span>
                  <span className="truncate max-w-[180px] sm:max-w-[260px] font-mono text-[11px]">
                    {activeErrorText}
                  </span>
                  <span className="text-[10px] font-semibold underline ml-0.5 shrink-0">
                    {showErrorDetails ? "Hide" : "Details"}
                  </span>
                </button>
              )}
              <span className="text-xs text-text-muted">#{connection.priority}</span>
              {connection.globalPriority && (
                <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
              )}
              {getOneByOneLabel() && (
                <Badge variant={getOneByOneVariant()} size="sm">
                  {getOneByOneLabel()}
                </Badge>
              )}
            </div>
            {hasAnyProxy && (
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                  {proxyDisplayText}
                </span>
                {maskedProxyUrl && (
                  <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                    {maskedProxyUrl}
                  </code>
                )}
                {noProxyText && (
                  <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                    no_proxy: {noProxyText}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
            {/* Proxy button with inline dropdown */}
            {(proxyPools || []).length > 0 && (
              <div className="relative" ref={proxyDropdownRef}>
                <button
                  onClick={() => setShowProxyDropdown((v) => !v)}
                  className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                  disabled={updatingProxy}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {updatingProxy ? "progress_activity" : "lan"}
                  </span>
                  <span className="text-[10px] leading-tight">Proxy</span>
                </button>
                {showProxyDropdown && (
                  <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                    <button
                      onClick={() => handleSelectProxy("__none__")}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      None
                    </button>
                    {(proxyPools || []).map((pool) => (
                      <button
                        key={pool.id}
                        onClick={() => handleSelectProxy(pool.id)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                      >
                        {pool.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {autoPing && (
              <Tooltip text={autoPingTooltip}>
                <button
                  onClick={() => autoPing.onToggle(!autoPing.on)}
                  className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPing.on ? "text-primary" : "text-text-muted hover:text-primary"}`}
                >
                  <span className="material-symbols-outlined text-[18px]">bolt</span>
                  <span className="text-[10px] leading-tight">Auto-ping</span>
                </button>
              </Tooltip>
            )}
            <button onClick={onEdit} className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5">
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button onClick={onDelete} className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10">
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
          <Toggle
            size="sm"
            checked={connection.isActive ?? true}
            onChange={onToggleActive}
            title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
          />
        </div>
      </div>

      {/* Expandable Error Details Box */}
      {showErrorDetails && activeErrorText && (
        <div className="w-full mt-2 rounded-lg border border-red-500/25 bg-red-950/20 dark:bg-red-950/30 p-3 text-xs text-red-400 backdrop-blur-sm transition-all">
          <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-red-500/20 text-red-300">
            <span className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider">
              <span className="material-symbols-outlined text-[15px]">error_outline</span>
              Full Error Details
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copy(activeErrorText)}
                className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 text-[11px] font-sans font-medium transition-colors cursor-pointer flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[13px]">content_copy</span>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setShowErrorDetails(false)}
                className="p-0.5 rounded hover:bg-red-500/20 text-red-300 transition-colors cursor-pointer"
                title="Hide Details"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar select-text font-mono bg-black/20 p-2.5 rounded border border-red-500/10">
            {formatErrorString(activeErrorText)}
          </pre>
        </div>
      )}
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
};
