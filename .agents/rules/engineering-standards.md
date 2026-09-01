# Engineering Standards & Quality Gates (addyosmani/agent-skills)

This workspace enforces senior engineering quality standards for all AI agent interactions.

---

## 🛑 Core Guardrails

1. **Spec Before Code (`/spec`)**:
   - Establish explicit schema definitions, API contracts, and requirements before writing production code.
   - Do not make unverified assumptions about data formats or system behavior.

2. **Test-Driven Verification (`/test`)**:
   - Every bug fix and new feature must be accompanied by empirical test verification (`Red ➔ Green ➔ Refactor`).
   - Never declare a task resolved without running actual verification commands in the terminal.

3. **No Superficial Symptom Patches**:
   - Never mask errors with silent `try/catch` blocks, dummy fallback constants, or deleted test assertions.
   - Always trace the upstream root cause.

4. **Incremental Implementation (`/build`)**:
   - Implement complex tasks in small, verifiable slices.
   - Validate each slice before moving to the next.

5. **5-Axis Code Review (`/review`)**:
   - Review code along 5 critical dimensions: Correctness, Security, Performance, Architecture, and Simplicity.
