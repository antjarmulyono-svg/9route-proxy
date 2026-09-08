#!/usr/bin/env bash
# ==============================================================================
# 9Router Antigravity Reset Script
# Restores /etc/hosts to default official Google Cloudcode servers
# ==============================================================================
set -e

if [ "$EUID" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "❌ Error: 'sudo' tidak ditemukan. Jalankan script ini sebagai root atau install sudo."
    exit 1
  fi
  SUDO="sudo"
fi

echo "🔄 Mengembalikan Antigravity ke settingan default Google..."
$SUDO sed -i '/cloudcode-pa.googleapis.com/d' /etc/hosts 2>/dev/null || true
$SUDO sed -i '/daily-cloudcode-pa.googleapis.com/d' /etc/hosts 2>/dev/null || true
echo "✅ /etc/hosts dibersihkan."

RESOLVED=$(getent ahostsv4 cloudcode-pa.googleapis.com 2>/dev/null | head -n 1 | awk '{print $1}')
if [ -n "$RESOLVED" ]; then
  echo "🌐 DNS sekarang mengarah ke IP publik Google: ${RESOLVED}"
else
  echo "🌐 DNS berhasil di-reset ke public resolver."
fi
echo "🚀 Antigravity siap dipakai langsung ke server Google resmi."
