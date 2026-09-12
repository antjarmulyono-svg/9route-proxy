import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

/**
 * Two suites depend on things that are legitimately absent from this checkout
 * rather than broken:
 *  - embeddings.cloud imports cloud/src/handlers/embeddings.js, and the cloud/
 *    worker lives in a separate repo (documented in CLAUDE.md).
 *  - db-benchmark compares SQLite against lowdb, which is not a declared
 *    dependency here.
 *
 * Both fail at collection time, so they never surface as assertion failures
 * and slip past verify-no-regression entirely. Excluding them only when the
 * dependency is genuinely missing keeps them running in a full checkout,
 * instead of deleting coverage to get a green run.
 */
const conditionalExcludes = [
  !existsSync(resolve(repoRoot, "cloud/src/handlers/embeddings.js")) &&
    "tests/unit/embeddings.cloud.test.js",
  !existsSync(resolve(repoRoot, "tests/node_modules/lowdb")) &&
    !existsSync(resolve(repoRoot, "node_modules/lowdb")) &&
    "tests/unit/db-benchmark.test.js",
].filter(Boolean);

export default defineConfig({
  root: repoRoot,
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/dist/**",
      ...conditionalExcludes,
    ],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
