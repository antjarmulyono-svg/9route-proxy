---
name: agent-skills-bridge
description: Bridges addyosmani/agent-skills engineering workflows with 9Router multi-model gateway & auto-fallback infrastructure.
---

# 9Router x Agent-Skills Bridge

This skill maps the **6-phase engineering lifecycle** from `addyosmani/agent-skills` to the optimal **9Router Multi-Model Combos & Capabilities**.

---

## 🎯 Model & Capability Mapping per Lifecycle Phase

| Lifecycle Phase | Slash Command | Activated Agent Skill | Recommended 9Router Model / Combo |
| :--- | :--- | :--- | :--- |
| **1. Define & Spec** | `/spec`, `/interview-me` | `spec-driven-development` | `Coding-Super-Combo` (`Claude 3.7 Sonnet` / `Gemini 3.1 Pro`) |
| **2. Planning** | `/plan`, `/planning` | `planning-and-task-breakdown` | `Coding-Super-Combo` (`Claude 3.7 Sonnet`) |
| **3. Build** | `/build`, `/build auto` | `incremental-implementation` | `Coding-Super-Combo` / `Fast-Agent-Combo` |
| **4. Test & Verify** | `/test` | `test-driven-development` | `Fast-Agent-Combo` (`Gemini 3.7 Flash High`) |
| **5. Review & Audit** | `/review`, `/webperf` | `code-review-and-quality` | `Coding-Super-Combo` + `9router-web-search` |
| **6. Shipping** | `/ship` | `shipping-and-launch` | `Coding-Super-Combo` |

---

## ⚡ Integration Guidelines for Agents

When executing tasks under `agent-skills`:
1. **Spec Before Code**: Never write code without an agreed contract or spec document.
2. **Empirical Verification**: Always run runtime commands (`npm test`, `vitest`, `curl`) to prove correctness before concluding turns.
3. **Automatic Fallback**: If an upstream model experiences rate limits (429), 9Router automatically handles failover across Claude Code and Antigravity accounts.
4. **Web Grounding & Research**: Use 9Router's built-in web endpoints (`/v1/models/web`) when verifying live documentation or external APIs.
