# Effect simplification: second pass

Baseline: `95111ba2076939ae8ab9820bd27428214858e245`. The first implementation and
its [acceptance report](acceptance/acceptance-report.md) are historical evidence,
not a reason to preserve unnecessary machinery. This pass keeps the simple public
SDK and optional native entrypoint while making the native implementation the
single owner of behavior.

## Measured starting point

The baseline has 59 production modules, 17,291 physical lines and 11,371 nonblank
comment-stripped lines (including types), 52 classes (29 error classes), and four
WeakMaps. Static conversion call sites include 79 `runPromise`, 83 `fromPromise`,
and three `tryPromise` calls. These are source-site counts, not dynamic crossings;
pure synchronous guards are counted separately. The repeatable inventory and
per-file data are in [simplification](simplification/architecture-baseline.json).

The first-pass complete root browser bundle is 131,292 gzip bytes. Seven-pair
no-network medians are 0.465 ms per client construction and 0.290 ms per Promise
view. A 20,000-construction CPU profile attributes 73% of sampled execution to
Effect.fn wrapper creation, supporting removal of repeated operation factories.
The profile is diagnostic, not an additional latency measurement.

## Design and dependency order

1. Keep one Effect RPC codec owner and infer response types from it. Remove the
   duplicate internal Zod RPC decoder and failure replay. Keep one native RPC
   service, one typed Promise projection and an explicit external-provider
   adapter. Remove method-identity registries and full-program cloning. Hoist
   named Effect.fn definitions, preserving traces.
2. Let native Near acquisition own resolved RPC, keys, wallet, readiness and
   transaction dependencies. Public Near projects that service. Native Layers
   must not construct a Promise client and adapt it back. Preserve eager public
   constructor key initialization and lazy native acquisition.
3. Give transactions native dependencies once, with one shared action/signature
   state and one execution engine. The documented public constructor adapts
   external providers at its boundary. Share equivalent preparation/signing work
   while retaining explicit versioned encoders and all nonce/retry safeguards.
4. Remove key-store/wallet prototype interception and repeated adaptation. Keep
   native service ownership, concrete public projections, and genuine external
   KeyStore/Signer/Wallet callbacks with receiver and rejection preservation.
5. Consume the required native client in React, simplify duplicate contract
   proxies, and remove dead prototype-extension helpers. Authority-bearing config
   must use identity-aware dependencies, not JSON equality that can retain an
   obsolete key store, signer or wallet.
6. Audit resource/nonce logic skeptically, but keep proven scope/finalizer,
   stop-before-restart and stale-reservation protections. A reservation allocator
   is not a TTL cache; eviction could reissue an in-flight nonce.

## Supported surface and deliberate internal cleanup

Retain simple `Near`, fluent transaction, contract, key-store, wallet, sandbox and
React APIs; explicit transport/service injection; pure crypto/Borsh semantics;
public domain error classes; and documented Zod composition exports.

Undocumented interception of built-in methods through monkeypatches/subclasses is
not a second dependency-injection system. Retire those paths and test real service
injection instead. Caller-supplied structural providers remain supported.
Internal invalid-RPC and invalid-config diagnostics use native Schema failures,
not legacy internal Zod issue objects. A path-string keyStore configuration never
opened a file store; reject that no-op explicitly and use `FileKeyStore` from its
Node-only subpath. The unpublished native API can be revised to eliminate circular
ownership and redundant service identities; document its final form.

## Implemented source checkpoint

At `1d314715725520178a9c659ee6bb6ef5832a8589`, the native service owns client
acquisition and all operations. There is one RPC codec and one RPC program set;
public clients project native capabilities only at Promise boundaries. Native
storage layers provide the common KeyStore service. React and native message
verification consume native capabilities directly. Compatibility Zod schemas stay
in their explicit subpaths and no longer load with root/native SDK imports.

The source inventory is now 57 modules, 14,761 physical lines and 9,608 nonblank
comment-stripped lines: reductions of 2 modules, 2,530 physical lines (14.6%), and
1,763 nonblank lines (15.5%). Classes fell from 52 to 50; the retained classes are
mostly public error/key/facade types and Effect service identities. WeakMaps fell
from four to zero. `fromPromise` sites fell from 83 to 40, `runPromise` from 79 to
78, and `tryPromise` from three to two. These three asynchronous boundary-site
categories total 165 to 120; this is a static inventory, not measured runtime
crossings. The full [candidate inventory](simplification/architecture-candidate.json)
includes pure synchronous guards separately.

Two independently demonstrated defects were repaired along the way: React now
updates signing authority when a JSON-equal wallet/key store is replaced, and
nonce retry eligibility comes only from an actual transaction submission failure,
never a pre-broadcast signer rejection. Constructor acquisition snapshots only the
two SDK environment settings at the public boundary; native acquisition honors
the caller's ConfigProvider. This avoids indexing the full process environment
for every new client.

The [test ownership ledger](simplification/test-retention.md) records deliberately
retired implementation checks, stronger replacement proof, retained safeguards,
and the exact literal-title change inventory. The source checkpoint passes all
local aggregate checks, 1,316 core/wallet tests and 54 React tests. Independent
isolated acceptance also passes Node 22.19/24, React 18/19, package/browser VM and
cross-tree codec/helper checks. [Exact-source CI](https://github.com/r-near/near-kit/actions/runs/36671572748)
passes 1,602 near-kit and 54 React tests, including all 286 real-chain integration
cases. The [acceptance report](simplification/acceptance/acceptance-report.md)
contains the complete evidence and environment limitations.

Matched-method root browser gzip drops from 131,292 to 112,111 bytes (14.6%);
native gzip drops from 132,948 to 109,856 (17.4%). Fresh seven-pair no-network
medians improve from 0.430 to 0.063 ms for construction and 0.269 to 0.153 ms for
Promise views. The root still adds 36.6% gzip versus the original pre-Effect SDK;
original-relative startup/read/construction overhead remains material. See the
report for both complete comparisons, raw samples, and method caveats.

## Acceptance gates

- Compare source/module/class/conversion-site inventory against the fixed baseline;
  do not count comment stripping as implementation simplification
- Repeat bundle and seven-pair microbenchmarks with the same controlled method
- Independently review the complete production tree and the deletion plan
- Preserve wire vectors, cancellation, finalization, negative decoding, nonce
  concurrency and replay bounds, true extension errors, and public consumer types
- Record exact retired tests and their stronger remaining owner-boundary evidence;
  test count is not a target
- Run all source/consumer/example, lint/format, unit, wallet, React and integration
  checks, with exact-head CI and environment limitations reported honestly

The original estimate was approximately 1,800–2,500 fewer meaningful production
lines. The measured result is 1,763 nonblank/comment-stripped lines and 2,530
physical lines removed through owner consolidation. Safeguards were retained
rather than deleting more to meet a quota. No merge, publication or deployment
is part of this experiment.
