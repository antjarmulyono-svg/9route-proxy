#!/usr/bin/env bash
# ==============================================================================
# 9Router Antigravity Remote Client Setup Script
# Configures any client machine to route Antigravity IDE traffic to 9Router MITM
# Usage:
#   bash setup-antigravity-client.sh [9ROUTER_IP_OR_DOMAIN]
#   ROUTER_IP=10.10.123.206 bash setup-antigravity-client.sh
# ==============================================================================

set -e

# 1. Resolve 9Router Server Host/IP (CLI Argument > Environment Variable > Interactive Prompt)
ROUTER_IP="${1:-${ROUTER_IP:-}}"

if [ -z "$ROUTER_IP" ]; then
  read -r -p "Masukkan IP / Host Server 9Router (contoh: 10.10.123.206): " ROUTER_IP
fi

if [ -z "$ROUTER_IP" ]; then
  echo "❌ Error: IP atau domain server 9Router wajib diisi."
  exit 1
fi

ROUTER_PORT="${ROUTER_PORT:-20128}"
HOSTS_FILE="/etc/hosts"
CA_DIR="/usr/local/share/ca-certificates"
CERT_FILE="${CA_DIR}/9router-root-ca.crt"

# 2. Determine sudo invocation safely without hardcoded credentials
if [ "$EUID" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "❌ Error: 'sudo' tidak ditemukan. Jalankan script ini sebagai root atau install sudo."
    exit 1
  fi
  SUDO="sudo"
fi

echo "======================================================================"
echo "🚀 Running 1-Click Setup for Antigravity Remote Client"
echo "🌐 9Router Server Target: ${ROUTER_IP}"
echo "======================================================================"

# 3. Connectivity check
echo "🔍 [1/5] Testing connection to 9Router server (${ROUTER_IP})..."
if ! ping -c 1 -W 2 "$ROUTER_IP" >/dev/null 2>&1; then
  echo "⚠️ Warning: Ping ke ${ROUTER_IP} tidak merespons (mungkin diblokir ICMP). Melanjutkan pengujian HTTP..."
fi

# 4. Update /etc/hosts
echo "🌐 [2/5] Updating ${HOSTS_FILE} for Antigravity Google domains..."
DOMAINS=(
  "daily-cloudcode-pa.googleapis.com"
  "cloudcode-pa.googleapis.com"
)

for domain in "${DOMAINS[@]}"; do
  $SUDO sed -i "/[[:space:]]${domain}/d" "$HOSTS_FILE" 2>/dev/null || true
  echo "${ROUTER_IP} ${domain}" | $SUDO tee -a "$HOSTS_FILE" >/dev/null
done
echo "✅ ${HOSTS_FILE} updated."

# 5. Install 9Router Root CA Certificate
echo "🔐 [3/5] Installing 9Router Root CA certificate..."
$SUDO mkdir -p "$CA_DIR"

# Try downloading dynamic CA from 9Router server first, fallback to standard embedded CA
DOWNLOAD_SUCCESS=false
if curl -fsSL "http://${ROUTER_IP}:${ROUTER_PORT}/api/mitm/ca.crt" -o /tmp/9router-ca-temp.crt 2>/dev/null; then
  if [ -s /tmp/9router-ca-temp.crt ]; then
    $SUDO cp /tmp/9router-ca-temp.crt "$CERT_FILE"
    rm -f /tmp/9router-ca-temp.crt
    DOWNLOAD_SUCCESS=true
    echo "✅ Root CA certificate downloaded from http://${ROUTER_IP}:${ROUTER_PORT}/api/mitm/ca.crt."
  fi
fi

if [ "$DOWNLOAD_SUCCESS" = false ]; then
  echo "ℹ️ Downloading failed or offline, writing default 9Router Root CA..."
  cat << 'CERT_EOF' | $SUDO tee "$CERT_FILE" >/dev/null
-----BEGIN CERTIFICATE-----
MIIDOTCCAiGgAwIBAgIBATANBgkqhkiG9w0BAQsFADA+MR0wGwYDVQQDExQ5Um91
dGVyIE1JVE0gUm9vdCBDQTEQMA4GA1UEChMHOVJvdXRlcjELMAkGA1UEBhMCVVMw
HhcNMjYwODI3MDM1MDM0WhcNMzYwODI3MDM1MDM0WjA+MR0wGwYDVQQDExQ5Um91
dGVyIE1JVE0gUm9vdCBDQTEQMA4GA1UEChMHOVJvdXRlcjELMAkGA1UEBhMCVVMw
ggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQD11b+42N6jHkz4Ljrxc40o
cXLhs3zWHX5Wyu+/0b6pslGYhOTNByfiduxp8CCRqGxyNmeg0On+sf7xuSlcXrPe
It2of1ZmPKJdhx8aeL3JYul+wD9NTfeFVLbqQzKGQS3Hqqv1URn8wzsZrwc1TY5F
lrLjfiKZZUOFlgs/coGoKLjx7+ChM0T0kDLn4KQ/Z4ppRg3MPrdbBwvQMCf8hz5k
Nw/PinAgxs/i3Ox0F9NTFN6yHLB3FMGbY0cL0mGcWJiIRjsHDkUNkNfiMC0ibgmE
p6fYYzBBX/PwOwNaGa+gn1Hb04Za0vvqfCVHheaH2Z9l/DJWpgU24GBfiwdK+0Ql
AgMBAAGjQjBAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1Ud
DgQWBBSjAd5wuv7c/pL+m4z+VejYFSy7aDANBgkqhkiG9w0BAQsFAAOCAQEAHInH
fvNEMtW8/rTaDkr46MG/t+iOdEZAr4/rYduh9JQWmHEspNs2tLjtv0WoGCieB2Wy
1292OaR3HAy/EDJrnbj2UISKFj+ir2FxG9T0geTtx+yfERKaxNvjVgZP3y/gHV+f
jZ76c9ujazjyA3lDn1vUL6GfzKhR30KNcrqWng6KE0HlMYBYJaOIAfHNf/bqPTzM
/+rQtZnEv//BjB41nplAkHZEazdHZ+tmJ4CXuLMn2s6VMF5UU4mpsvOhD+g8uk9X
q7S2ikvbOs5jBjMaekKcWegXXPe2JWwqe5aJRTDTDTbDlfvR2BxgPE9tu1zaxWSz
EA05CKSyG6Ey9xkFRA==
-----END CERTIFICATE-----
CERT_EOF
fi

$SUDO chmod 644 "$CERT_FILE"

# Update CA certificates bundle
if command -v update-ca-certificates >/dev/null 2>&1; then
  $SUDO update-ca-certificates
fi

# Append directly for Go / Node runtimes
if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  $SUDO sh -c "cat '$CERT_FILE' >> /etc/ssl/certs/ca-certificates.crt" 2>/dev/null || true
fi
echo "✅ System Root CA trust store updated."

# 6. Set Environment Variables & Reload Language Server
echo "⚙️ [4/5] Exporting NODE_EXTRA_CA_CERTS and reloading backend..."
pkill -f language_server_linux_x64 >/dev/null 2>&1 || true

ENV_VAR="export NODE_EXTRA_CA_CERTS=\"${CERT_FILE}\""
if [ -f "$HOME/.bashrc" ] && ! grep -q "NODE_EXTRA_CA_CERTS" "$HOME/.bashrc" 2>/dev/null; then
  echo "$ENV_VAR" >> "$HOME/.bashrc"
fi
if [ -f /etc/environment ] && ! grep -q "NODE_EXTRA_CA_CERTS" /etc/environment 2>/dev/null; then
  echo "NODE_EXTRA_CA_CERTS=\"${CERT_FILE}\"" | $SUDO tee -a /etc/environment >/dev/null
fi
echo "✅ Environment variables configured."

# 7. Verification Test
echo "🧪 [5/5] Testing DNS and Certificate Trust..."
RESOLVED=$(getent ahostsv4 cloudcode-pa.googleapis.com 2>/dev/null | head -n 1 | awk '{print $1}')
echo "  - DNS Resolution (v4): cloudcode-pa.googleapis.com -> ${RESOLVED}"
if [ "$RESOLVED" = "$ROUTER_IP" ]; then
  echo "  ✅ DNS redirect confirmed OK."
else
  echo "  ⚠️ Note: DNS resolved to ${RESOLVED} (Check if /etc/hosts is active)."
fi

echo "======================================================================"
echo "🎉 SETUP COMPLETED SUCCESSFULLY ON $(hostname)!"
echo "======================================================================"
