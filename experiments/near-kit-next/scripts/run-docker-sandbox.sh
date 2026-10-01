#!/usr/bin/env bash
# Only standard Docker on the authorized isolated runner; no privileged flags.
set -euo pipefail
image=nearprotocol/sandbox@sha256:1f36ba675ecce97cf5311b8f29f6ca7c42af17b6d6c45d38a652f0f9bad282a7
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
init="near-read-$suffix-init"
node="near-read-$suffix-node"
home=$(mktemp -d "${RUNNER_TEMP:-/tmp}/near-read-genesis.XXXXXX")
mkdir -p artifacts/sandbox
cleanup() {
  status=$?
  docker logs "$node" > artifacts/sandbox/node.log 2>&1 || true
  docker rm -f "$node" "$init" >/dev/null 2>&1 || true
  rm -rf -- "$home"
  exit "$status"
}
trap cleanup EXIT
printf 'Hard descriptor limit: '; ulimit -Hn
docker version --format 'Client={{.Client.Version}} Server={{.Server.Version}}'
docker info --format 'Driver={{.Driver}} SecurityOptions={{json .SecurityOptions}}'
docker pull "$image"
docker image inspect "$image" --format '{{json .RepoDigests}}' > artifacts/sandbox/image.json
docker create --name "$init" --entrypoint near-sandbox "$image" \
  --home /data init --fast --account-id sandbox --test-seed sandbox --chain-id near-kit-read-fixture >/dev/null
docker start -a "$init"
test "$(docker inspect --format '{{.State.ExitCode}}' "$init")" = 0
docker cp "$init:/data/genesis.json" "$home/genesis.json"
node scripts/seed-sandbox.mjs "$home/genesis.json"
docker run -d --name "$node" --publish 127.0.0.1::3030 \
  --mount "type=bind,source=$home/genesis.json,target=/config/genesis.json,readonly" \
  --env NEAR_ROOT_ACCOUNT=sandbox --env NEAR_TEST_SEED=sandbox --env NEAR_CHAIN_ID=near-kit-read-fixture \
  "$image" >/dev/null
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3030/tcp") 0).HostPort}}' "$node")
export NEAR_SANDBOX_URL="http://127.0.0.1:$port"
node scripts/wait-sandbox.mjs
docker exec "$node" near-sandbox --version | tee artifacts/sandbox/version.txt
npm run test:sandbox
