// Pool fitness registry — shared, in-memory, engine layer.
//
// Rotation strategies can opt into region/provider-aware pool selection: an
// executor that learns a pool's egress is unfit for a provider/model (e.g.
// Freebuff limited-mode IP) marks it here, and the pool picker skips it for
// that scope until the cooldown expires.

const FITNESS_STATE_KEY = "__9routerPoolFitness__";
const fitness = (globalThis[FITNESS_STATE_KEY] ??= new Map()); // poolId -> Map<scope, { until, reason }>
let persistTimer = null;
let hydratePromise = null;

export const POOL_UNFIT_MS = 5 * 60 * 1000;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
      await updateSettings({ proxyPoolFitness: poolFitnessSnapshot() });
    } catch {
      // Fitness is advisory; persistence failures must not block requests.
    }
  }, 25);
  if (persistTimer.unref) persistTimer.unref();
}

export function hydratePoolFitness(snapshot = {}) {
  for (const [poolId, byScope] of Object.entries(snapshot || {})) {
    const entries = Object.entries(byScope || {}).filter(([, entry]) => Number(entry?.until) > Date.now());
    if (entries.length) fitness.set(poolId, new Map(entries));
  }
}

export async function ensurePoolFitnessHydrated() {
  if (!hydratePromise) {
    hydratePromise = import("@/lib/db/repos/settingsRepo.js")
      .then(({ getSettings }) => getSettings())
      .then((settings) => hydratePoolFitness(settings.proxyPoolFitness || {}))
      .catch(() => {})
      .then(() => undefined);
  }
  return hydratePromise;
}

export function markPoolUnfit(poolId, scope, until = Date.now() + POOL_UNFIT_MS, reason = "") {
  if (!poolId || !scope) return;
  const byScope = fitness.get(poolId) || new Map();
  byScope.set(scope, { until, reason });
  fitness.set(poolId, byScope);
  schedulePersist();
}

export function clearPoolUnfit(poolId, scope) {
  const byScope = fitness.get(poolId);
  if (!byScope) return;
  byScope.delete(scope);
  if (byScope.size === 0) fitness.delete(poolId);
  schedulePersist();
}

function providerWildcardScope(scope) {
  const sep = String(scope || "").indexOf("::");
  if (sep < 0) return null;
  return `${scope.slice(0, sep)}::*`;
}

export function isPoolFit(poolId, scope, now = Date.now()) {
  if (!poolId) return true;
  const byScope = fitness.get(poolId);
  if (!byScope) return true;
  const candidates = [scope, providerWildcardScope(scope)];
  for (const key of candidates) {
    if (!key) continue;
    const entry = byScope.get(key);
    if (!entry) continue;
    if (entry.until <= now) {
      byScope.delete(key);
      if (byScope.size === 0) fitness.delete(poolId);
      continue;
    }
    return false;
  }
  return true;
}

export function fitPoolIds(poolIds, scope, now = Date.now()) {
  return (poolIds || []).filter((id) => isPoolFit(id, scope, now));
}

export function clearAllPoolUnfit(provider = null) {
  if (provider) {
    const prefix = `${provider}::`;
    for (const [poolId, byScope] of fitness) {
      for (const scope of [...byScope.keys()]) {
        if (scope.startsWith(prefix)) byScope.delete(scope);
      }
      if (byScope.size === 0) fitness.delete(poolId);
    }
    schedulePersist();
    return;
  }
  fitness.clear();
  schedulePersist();
}

export function resetPoolFitness() {
  fitness.clear();
  hydratePromise = Promise.resolve();
  schedulePersist();
}

export function pruneExpired(now = Date.now()) {
  let removed = 0;
  for (const [poolId, byScope] of fitness) {
    for (const [scope, entry] of byScope) {
      if (entry.until <= now) {
        byScope.delete(scope);
        removed += 1;
      }
    }
    if (byScope.size === 0) fitness.delete(poolId);
  }
  if (removed) schedulePersist();
  return removed;
}

export function poolFitnessSnapshot(now = Date.now()) {
  const out = {};
  for (const [poolId, byScope] of fitness) {
    let pruned = false;
    for (const [scope, entry] of byScope) {
      if (entry.until <= now) {
        byScope.delete(scope);
        pruned = true;
      }
    }
    if (byScope.size === 0) {
      fitness.delete(poolId);
      continue;
    }
    if (pruned || byScope.size > 0) {
      out[poolId] = Object.fromEntries(byScope);
    }
  }
  return out;
}
