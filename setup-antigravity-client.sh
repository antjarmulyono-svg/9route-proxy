#!/usr/bin/env bash
# ==============================================================================
# 9Router Antigravity Remote Client Setup Script
# Target Client: 10.10.123.147 (dev-meninjar)
# 9Router Server: 10.10.123.206 (MITM Proxy on Port 443 & API on Port 20128)
# ==============================================================================

set -e

ROUTER_IP="10.10.123.206"
HOSTS_FILE="/etc/hosts"
CA_DIR="/usr/local/share/ca-certificates"
CERT_FILE="${CA_DIR}/9router-root-ca.crt"

# Determine sudo invocation
if [ "$EUID" -eq 0 ]; then
  SUDO=""
else
  SUDO="echo zahwa2904 | sudo -S"
fi

echo "======================================================================"
echo "🚀 Running 1-Click Setup for Antigravity Remote Client"
echo "======================================================================"

# 1. Ping Check
echo "🔍 [1/5] Testing connection to 9Router server (${ROUTER_IP})..."
if ! ping -c 1 -W 2 "$ROUTER_IP" >/dev/null 2>&1; then
  echo "❌ Error: Cannot reach 9Router server at ${ROUTER_IP}"
  exit 1
fi
echo "✅ 9Router server ${ROUTER_IP} is reachable."

# 2. Update /etc/hosts
echo "🌐 [2/5] Updating ${HOSTS_FILE} for Antigravity Google domains..."
DOMAINS=(
  "daily-cloudcode-pa.googleapis.com"
  "cloudcode-pa.googleapis.com"
)

for domain in "${DOMAINS[@]}"; do
  eval "$SUDO sed -i '/$domain/d' '$HOSTS_FILE'" || true
  echo "${ROUTER_IP} ${domain}" | eval "$SUDO tee -a '$HOSTS_FILE'" >/dev/null
done
echo "✅ /etc/hosts updated."

# 3. Install 9Router Root CA Certificate
echo "🔐 [3/5] Installing 9Router Root CA certificate..."
eval "$SUDO mkdir -p '$CA_DIR'"

cat << 'CERT_EOF' | eval "$SUDO tee '$CERT_FILE'" >/dev/null
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

eval "$SUDO chmod 644 '$CERT_FILE'"
if command -v update-ca-certificates >/dev/null 2>&1; then
  eval "$SUDO update-ca-certificates"
fi
# Direct append to ensure Go and C runtimes trust it immediately
if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  eval "$SUDO sh -c 'cat \"$CERT_FILE\" >> /etc/ssl/certs/ca-certificates.crt'"
fi
echo "✅ System Root CA trust store updated."

# 4. Set Environment Variables & Restart Language Server
echo "⚙️ [4/5] Exporting NODE_EXTRA_CA_CERTS and reloading backend..."
pkill -f language_server_linux_x64 >/dev/null 2>&1 || true
ENV_VAR="export NODE_EXTRA_CA_CERTS=\"${CERT_FILE}\""
if ! grep -q "NODE_EXTRA_CA_CERTS" "$HOME/.bashrc" 2>/dev/null; then
  echo "$ENV_VAR" >> "$HOME/.bashrc"
fi
if ! grep -q "NODE_EXTRA_CA_CERTS" /etc/environment 2>/dev/null; then
  echo "NODE_EXTRA_CA_CERTS=\"${CERT_FILE}\"" | eval "$SUDO tee -a /etc/environment" >/dev/null
fi
echo "✅ Environment variables configured."

# 5. Verification Test
echo "🧪 [5/5] Testing DNS and Certificate Trust..."
RESOLVED=$(getent ahostsv4 cloudcode-pa.googleapis.com | head -n 1 | awk '{print $1}')
echo "  - DNS Resolution (v4): cloudcode-pa.googleapis.com -> ${RESOLVED}"
if [ "$RESOLVED" = "$ROUTER_IP" ]; then
  echo "  ✅ DNS redirect confirmed OK."
else
  echo "  ⚠️ Warning: DNS resolved to ${RESOLVED}"
fi

echo "======================================================================"
echo "🎉 1-CLICK SETUP COMPLETED SUCCESSFULLY ON $(hostname)!"
echo "======================================================================"
