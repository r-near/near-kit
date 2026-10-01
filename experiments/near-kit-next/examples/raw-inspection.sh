#!/bin/sh
# Official full-wire RPC reads. Requires POSIX sh and curl >=8.4 (including
# unknown-length --max-filesize enforcement). Output can be a JSON-RPC error;
# a nonzero exit can leave partial stdout. curl owns signals, sockets and stdout.
# A stalled stdout sink can exceed --max-time; SIGINT still terminates curl.
set -eu
usage() { echo 'Usage: raw-inspection.sh RPC_URL {genesis|config|block HASH|chunk HASH}' >&2; exit 2; }
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
url=$1
command=$2
case "$command:$#" in
  genesis:2) method=genesis_config; params='[]' ;;
  config:2) method=EXPERIMENTAL_protocol_config; params='{"finality":"final"}' ;;
  block:3|chunk:3)
    hash=$3
    case "$hash" in ''|*[!1-9A-HJ-NP-Za-km-z]*) usage ;; esac
    [ "${#hash}" -ge 32 ] && [ "${#hash}" -le 44 ] || usage
    method=$command
    if [ "$command" = block ]; then field=block_id; else field=chunk_id; fi
    params=$(printf '{"%s":"%s"}' "$field" "$hash") ;;
  *) usage ;;
esac
version=$(curl --disable --version)
version=${version#curl }
version=${version%% *}
major=${version%%.*}
minor=${version#*.}; minor=${minor%%.*}
case "$major:$minor" in *[!0-9:]*|'':*) echo 'Cannot determine curl version' >&2; exit 2 ;; esac
if [ "$major" -lt 8 ] || { [ "$major" -eq 8 ] && [ "$minor" -lt 4 ]; }; then
  echo 'curl >=8.4 is required for bounded unknown-length bodies' >&2; exit 2
fi
body=$(printf '{"jsonrpc":"2.0","id":"inspect","method":"%s","params":%s}' "$method" "$params")
# -q/--disable must be first: no hidden curlrc redirects/retries or extra actions.
# Deliberately no retry, redirect following, parsing, or second lifecycle adapter.
exec curl --disable --silent --show-error --fail-with-body --globoff \
  --proto '=http,https' --disallow-username-in-url --no-location \
  --max-time 15 --max-filesize 16777216 \
  --header 'content-type: application/json' --data "$body" --url "$url"
