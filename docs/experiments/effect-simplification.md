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

Target approximately 1,800–2,500 fewer meaningful production lines through actual
owner consolidation, not an arbitrary deletion quota. Size and performance gains
remain hypotheses until measured. No merge, publication or deployment is part of
this experiment.
