#!/bin/sh
# Post-deploy gate for the production stack. Fails loudly instead of letting a
# half-started stack pass as a successful deploy: the router must answer its
# health endpoint, and both sidecars must be reachable from inside it.
set -eu

ROUTER="${ROUTER_CONTAINER:-9router}"
PORT="${PORT:-20128}"
TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-90}"

fail() {
  echo "DEPLOY_HEALTH=FAIL: $1" >&2
  exit 1
}

echo "Waiting up to ${TIMEOUT}s for ${ROUTER} on :${PORT}..."
elapsed=0
until docker exec "$ROUTER" node -e "fetch('http://127.0.0.1:${PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  elapsed=$((elapsed + 3))
  [ "$elapsed" -ge "$TIMEOUT" ] && fail "${ROUTER} /api/health not ready after ${TIMEOUT}s"
  sleep 3
done
echo "  router  /api/health  OK"

docker exec "$ROUTER" node -e "fetch(process.env.HEADROOM_URL.replace(/\/$/,'')+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  || fail "headroom /readyz unreachable from ${ROUTER} (check: docker inspect headroom)"
echo "  headroom /readyz     OK"

docker exec "$ROUTER" node -e "require('dns').lookup(process.env.AG_INJECTOR_HOST,(e)=>process.exit(e?1:0))" \
  || fail "ag-injector does not resolve from ${ROUTER} (network mismatch)"
echo "  ag-injector DNS      OK"

echo "DEPLOY_HEALTH=OK"
