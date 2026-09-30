"use client";

import { useState, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const FORMATS_HELP = `Supported formats:

TXT (one per line):
  email@example.com:password
  email@example.com|password
  email@example.com,password

JSON:
  [{"email": "...", "password": "..."}]
  {"accounts": [{"email": "...", "password": "..."}]}

If passwords are omitted, fill in the shared password field below.`;

function parseAccounts(rawText, sharedPassword) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.accounts)
          ? parsed.accounts
          : [parsed];
      return list
        .map((item) => ({
          email: (item.email || item.username || item.user || "").trim(),
          password: (item.password || item.pass || sharedPassword || "").trim(),
        }))
        .filter((x) => x.email && x.password);
    } catch {
      // fall through to line parser
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.startsWith("//")) continue;

    const delimMatch = l.match(/[:|\t,]/);
    if (delimMatch) {
      const idx = delimMatch.index;
      const email = l.slice(0, idx).trim();
      const password = l.slice(idx + 1).trim() || sharedPassword;
      if (email && password) {
        result.push({ email, password });
      }
      continue;
    }

    if (l.includes("@") && sharedPassword) {
      result.push({ email: l, password: sharedPassword });
    }
  }
  return result;
}

export default function BulkImportAntigravityModal({
  isOpen,
  onClose,
  onSuccess,
}) {
  const [inputText, setInputText] = useState("");
  const [sharedPassword, setSharedPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState("");
  const fileRef = useRef(null);

  const parsed = parseAccounts(inputText, sharedPassword);

  const handleClose = () => {
    if (submitting) return;
    setInputText("");
    setSharedPassword("");
    setParseError("");
    setResult(null);
    setProgress("");
    onClose();
  };

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setInputText(ev.target.result || "");
      setParseError("");
      setResult(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setInputText(ev.target.result || "");
      setParseError("");
      setResult(null);
    };
    reader.readAsText(file);
  }, []);

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);
    setProgress("");

    if (parsed.length === 0) {
      setParseError(
        translate(
          "No valid accounts detected. Check format or fill shared password."
        )
      );
      return;
    }

    setSubmitting(true);
    setProgress(`Processing ${parsed.length} account(s)...`);

    try {
      const res = await fetch("/api/oauth/antigravity/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: parsed }),
      });

      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error || `Request failed: ${res.status}`);
        return;
      }

      setResult(data);
      setProgress("");
      if (data.success > 0 && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];
  const successItems = result?.results?.filter((r) => r.ok) || [];

  return (
    <Modal
      isOpen={isOpen}
      title={translate("Bulk Import Antigravity Accounts")}
      onClose={handleClose}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted whitespace-pre-line">
          {FORMATS_HELP}
        </p>

        <div
          className="relative"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <textarea
            className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[160px] focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={`zazeye973@deciw.com:Hasna99#\nczasza188@deciw.com:Hasna99#`}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setParseError("");
              setResult(null);
            }}
            disabled={submitting}
          />
          {!inputText && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-xs text-text-muted opacity-50">
                {translate("or drag & drop a .txt / .json file here")}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">
              {translate("Shared Password (optional)")}
            </label>
            <input
              type="password"
              className="w-full rounded border border-accent/30 bg-sidebar px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={translate("Used when password is not per-line")}
              value={sharedPassword}
              onChange={(e) => setSharedPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="upload_file"
            onClick={() => fileRef.current?.click()}
            disabled={submitting}
          >
            {translate("Upload")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,.csv"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {parsed.length > 0 && !result && (
          <div className="text-xs text-green-400 font-medium">
            {translate("Detected")} {parsed.length}{" "}
            {translate("valid account(s)")}
          </div>
        )}

        {parseError && (
          <p className="text-xs text-red-500 break-words">{parseError}</p>
        )}

        {progress && (
          <div className="text-xs text-blue-400 animate-pulse">{progress}</div>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-yellow-400" : "text-green-400"
              }`}
            >
              ✓ {result.success} {translate("imported")}
              {result.failed > 0
                ? `, ✗ ${result.failed} ${translate("failed")}`
                : ""}
            </div>
            {successItems.length > 0 && (
              <ul className="rounded border border-green-500/20 bg-sidebar/50 p-2 text-xs font-mono max-h-32 overflow-y-auto">
                {successItems.map((item, idx) => (
                  <li key={idx} className="text-green-400">
                    ✓ {item.email}
                    {item.project ? ` (${item.project})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {failedItems.length > 0 && (
              <ul className="rounded border border-red-500/20 bg-sidebar/50 p-2 text-xs font-mono max-h-32 overflow-y-auto">
                {failedItems.map((item, idx) => (
                  <li key={idx} className="text-red-400">
                    ✗ {item.email}: {item.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || parsed.length === 0}
          >
            {submitting
              ? translate("Importing...")
              : `${translate("Import")} ${parsed.length > 0 ? `(${parsed.length})` : ""}`}
          </Button>
          <Button
            onClick={handleClose}
            variant="ghost"
            fullWidth
            disabled={submitting}
          >
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkImportAntigravityModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
