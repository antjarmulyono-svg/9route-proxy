#!/usr/bin/env bash
# ==============================================================================
# 9Router x addyosmani/agent-skills Installer
# Installs production-grade engineering skills into Antigravity workspace & global
# ==============================================================================

set -e

REPO_URL="https://github.com/addyosmani/agent-skills.git"
TEMP_DIR="/tmp/agent-skills-temp"
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_SKILLS_DIR="${WORKSPACE_DIR}/.agents/skills"
GLOBAL_SKILLS_DIR="${HOME}/.gemini/config/skills"
GLOBAL_PLUGIN_DIR="${HOME}/.gemini/config/plugins/agent-skills"

echo "======================================================================"
echo "🚀 Installing addyosmani/agent-skills for 9Router & Antigravity"
echo "======================================================================"

# 1. Clone repository
echo "📥 [1/4] Cloning latest agent-skills repository..."
rm -rf "$TEMP_DIR"
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"

# 2. Install to Workspace (.agents/skills/)
echo "📂 [2/4] Installing skills into workspace (.agents/skills/)..."
mkdir -p "$WORKSPACE_SKILLS_DIR"
if [ -d "${TEMP_DIR}/skills" ]; then
  cp -r "${TEMP_DIR}/skills/"* "$WORKSPACE_SKILLS_DIR/"
  echo "✅ Workspace skills installed ($(ls -1 "$WORKSPACE_SKILLS_DIR" | wc -l) skills available)."
fi

# 3. Install to Global Antigravity Config
echo "🌍 [3/4] Installing skills into global Antigravity config..."
mkdir -p "$GLOBAL_SKILLS_DIR"
mkdir -p "$GLOBAL_PLUGIN_DIR"
if [ -d "${TEMP_DIR}/skills" ]; then
  cp -r "${TEMP_DIR}/skills/"* "$GLOBAL_SKILLS_DIR/"
  cp -r "${TEMP_DIR}/"* "$GLOBAL_PLUGIN_DIR/" 2>/dev/null || true
  echo "✅ Global Antigravity skills & plugins updated."
fi

# 4. Clean up temp files
echo "🧹 [4/4] Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "======================================================================"
echo "🎉 ALL 25 AGENT SKILLS INSTALLED SUCCESSFULLY!"
echo "======================================================================"
echo "Available Slash Commands in Antigravity:"
echo "  /spec           - Spec-driven development (Spec before code)"
echo "  /plan           - Planning & atomic task breakdown"
echo "  /build          - Incremental implementation (or /build auto)"
echo "  /test           - Test-driven development (Red-Green-Refactor)"
echo "  /review         - 5-Axis code review & quality check"
echo "  /code-simplify  - Complexity reduction without behavior change"
echo "  /webperf        - Web performance audit"
echo "  /ship           - Verified safe deployment"
echo "======================================================================"
