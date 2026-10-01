// Pins one conversation to one account for its whole lifetime.
//
// Providers that mint per-project thought signatures (Antigravity/Gemini) reject a
// history whose signatures were issued under a different Google project:
//   400 INVALID_ARGUMENT "Corrupted thought signature."
// Round-robin across accounts therefore breaks any tool-using conversation the moment
// it rotates. Pinning keeps every account in play — different conversations still
// spread across all of them — while a single conversation never switches mid-flight.
//
// Fallback still overrides the pin when the pinned account is genuinely unavailable;
// a broken signature beats a dead request. The pin then follows to whichever account
// actually served the turn, so the next turn stays with it.

const MAX_ENTRIES = 2000;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — longer than any realistic single conversation

/** @type {Map<string, {connectionId: string, lastUsed: number}>} insertion-ordered LRU */
const affinity = new Map();

function makeKey(provider, sessionKey) {
  return `${provider}:${sessionKey}`;
}

function evictExpired(now) {
  for (const [key, entry] of affinity) {
    if (now - entry.lastUsed <= TTL_MS) break; // insertion order → oldest first
    affinity.delete(key);
  }
}

/**
 * The account this conversation is pinned to, or null when it has none yet.
 * @returns {string|null}
 */
export function getPinnedConnectionId(provider, sessionKey) {
  if (!provider || !sessionKey) return null;
  const key = makeKey(provider, sessionKey);
  const entry = affinity.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.lastUsed > TTL_MS) {
    affinity.delete(key);
    return null;
  }

  // Re-insert to refresh LRU position
  affinity.delete(key);
  entry.lastUsed = now;
  affinity.set(key, entry);
  return entry.connectionId;
}

/** Record the account that served this conversation's latest turn. */
export function pinConnectionId(provider, sessionKey, connectionId) {
  if (!provider || !sessionKey || !connectionId) return;
  const key = makeKey(provider, sessionKey);
  const now = Date.now();

  evictExpired(now);
  affinity.delete(key);
  affinity.set(key, { connectionId, lastUsed: now });

  while (affinity.size > MAX_ENTRIES) {
    affinity.delete(affinity.keys().next().value);
  }
}

/** Drop a pin — used when the pinned account turns out to be unavailable. */
export function unpinConnectionId(provider, sessionKey) {
  if (!provider || !sessionKey) return;
  affinity.delete(makeKey(provider, sessionKey));
}

/** Test seam. */
export function clearAccountAffinity() {
  affinity.clear();
}
