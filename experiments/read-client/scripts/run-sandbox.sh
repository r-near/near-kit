#!/usr/bin/env bash
# Ordinary process in the existing isolated runner. No Docker/privilege changes.
set -euo pipefail
version=2.13.4
checksum=5690a4635172263cf026683f75965cac09dd916912584f12709974fed620163f
mkdir -p artifacts/sandbox
archive="$PWD/artifacts/sandbox/near-sandbox-$version.tar.gz"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/$version/near-sandbox.tar.gz" -o "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check
mkdir -p artifacts/sandbox/bin
tar -xzf "$archive" --strip-components=1 -C artifacts/sandbox/bin
binary="$PWD/artifacts/sandbox/bin/near-sandbox"
home=$(mktemp -d "${RUNNER_TEMP:-/tmp}/near-read-fixture.XXXXXX")
pid=''
cleanup() {
  status=$?
  if [[ -n "$pid" ]]; then
    if jobs -pr | grep -Fxq "$pid"; then kill -TERM "$pid" 2>/dev/null || true; fi
    for _ in $(seq 1 100); do
      jobs -pr | grep -Fxq "$pid" || break
      sleep 0.1
    done
    if jobs -pr | grep -Fxq "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf -- "$home"
  exit "$status"
}
trap cleanup EXIT
"$binary" --version | tee artifacts/sandbox/version.txt
"$binary" --home "$home" init --fast --account-id sandbox --test-seed sandbox --chain-id near-kit-read-fixture
node scripts/seed-sandbox.mjs "$home/genesis.json"
RUST_LOG=neard::cli=off,near=warn,stats=error,network=error \
  "$binary" --home "$home" run --rpc-addr 127.0.0.1:3039 --network-addr 127.0.0.1:3040 \
  > artifacts/sandbox/node.log 2>&1 &
pid=$!
export NEAR_SANDBOX_URL=http://127.0.0.1:3039
node scripts/wait-sandbox.mjs
npm run test:sandbox
