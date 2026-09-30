# Effect-native experiment

This branch is an experiment, not a published release. It pins Effect
`4.0.0-rc.118`, a prerelease. The familiar `near-kit` Promise API and
`@near-kit/react` APIs remain available. The optional `near-kit/effect` entrypoint
exposes native programs, typed failures, services, layers, and streams.

The [second-pass simplification](effect-simplification.md) is in progress.
`make(config)` now acquires the native service directly, without a Promise-client
backreference. Node storage layers provide the common `KeyStore` service.
Path-string `keyStore` configurations are rejected; supply a real `FileKeyStore`
from `near-kit/keys/file` instead.

## Existing applications

```ts
import { Near } from "near-kit"

const near = new Near({ network: "testnet" })
const balance = await near.getBalance("alice.testnet")
```

Existing fluent transactions, contracts, wallet connectors, key-store interfaces,
error classes, explicit nonces, and wire encodings are retained. Use explicit transport and service injection for customization; arbitrary
mutation of built-in methods is not a supported interception mechanism. Internally, `NonceManager` and the
old RPC implementation class have been removed. The only Promise conversions are
public compatibility boundaries and integrations that themselves expose Promises.

## Native programs

```ts
import * as Effect from "effect/Effect"
import { Near } from "near-kit/effect"

const program = Effect.gen(function* () {
  const near = yield* Near
  return yield* near.getBalance("alice.testnet")
})

const balance = await Effect.runPromise(
  program.pipe(Effect.provide(Near.layer({ network: "testnet" }))),
)
```

Constructing an Effect does not execute it. Retries use schedules; interruption
propagates to cooperative HTTP/resource boundaries. A supplied third-party
Promise may ignore cancellation, so interrupting an Effect does not imply a
wallet approval or submitted blockchain transaction was rolled back.

`Near.layer(config)` is a convenient fully configured client layer.
`Near.layerWithRpc(config)` requires an explicit `Rpc` service.
`Near.layerWithServices(config)` requires `Rpc`, `KeyStore`, and
`NonceReservation`; those injected services actually own RPC, key lookup, and nonce
allocation. `Near.layerWithWallet(config)` also requires `Wallet`.

```ts
import * as Layer from "effect/Layer"
import { InMemoryKeyStore } from "near-kit"
import { KeyStore, Near, NonceReservation, Rpc } from "near-kit/effect"

const client = Near.layerWithServices({
  defaultSignerId: "alice.testnet",
}).pipe(
  Layer.provide(
    Layer.mergeAll(
      Rpc.layerFetch({ url: "https://rpc.testnet.near.org" }),
      KeyStore.layer(new InMemoryKeyStore()),
      NonceReservation.layer,
    ),
  ),
)
```

Provide actual keys or a wallet before signing. Do not create independent nonce
reservation domains for the same signing key while transactions are in flight.
The Promise API keeps its shared default allocator. Explicit native layers can
supply a deliberately shared allocator; reservation state is not a TTL cache and
must not be evicted like ordinary reads.

Native transaction terminal methods return Effects:

```ts
const program = Effect.gen(function* () {
  const near = yield* Near
  return yield* near
    .transaction("alice.testnet")
    .transfer("bob.testnet", "1 NEAR")
    .sign()
})
```

Signing does not broadcast. Calling `.send()` builds an Effect that broadcasts
when executed. Pure fluent construction and pure cryptographic/wire algorithms
remain ordinary synchronous operations; high-level Effect operations classify
expected input/encoding failures in their failure channel.

## Errors and public boundaries

Native operations retain SDK domain error classes, use native `SchemaError`
for invalid internal config/RPC data, and use `ExternalError` for failures
from Promise-only extensions. Its `operation` identifies the boundary and its
`cause` retains the original value, including non-Error rejections. Promise-facing
methods unwrap that cause to preserve existing rejection identity. Programmer
errors remain defects rather than being silently recovered.

## Resources and browser boundaries

The main and native core entrypoints are browser-safe. Node-only resources use
separate subpaths:

- `near-kit/keys/file`, `near-kit/keys/native`, `near-kit/sandbox`
- `near-kit/effect/keys/file`, `near-kit/effect/keys/native`,
  `near-kit/effect/sandbox`

Native sandbox acquisition is scoped. Closing its scope terminates owned child
processes and cleans temporary directories, interrupted downloads, and in-flight
restarts. The legacy `Sandbox.start()`/`stop()` interface owns and closes the same
native scope. Snapshots preserve current gas-key permissions and extra nearcore
fields.

React uses native programs when given a real `Near` client. Superseded and
unmounted read requests are interrupted; state is observed through
`SubscriptionRef`. Mutation Promises retain their own results, while only the
newest active request can update the mounted UI. Unmounting disconnects UI state;
it does not pretend to undo a submitted transaction.

## Compatibility and measured cost

Existing Zod schemas under `near-kit/schemas` remain Zod schemas. Native RPC codecs
use one Effect Schema owner and preserve accepted wire defaults and unknown-field
behavior. Internal config/RPC diagnostics no longer replay a duplicate Zod decoder. Amount, Borsh, crypto, and signed-transaction commitments are
covered by independent unchanged vectors.

The added Effect runtime and native schemas have a measurable footprint. Final
browser sizes, microbenchmark methodology, runtime versions, and baseline
comparisons are recorded in the [acceptance report](acceptance/acceptance-report.md). Synthetic no-network timings
are not production RPC latency. This experiment does not claim a performance
improvement or a release recommendation.

## Toolchain and validation

Development uses Bun 1.4.2, TypeScript 7.0.2, `@effect/tsgo` 0.47.0, Oxlint 1.86.0,
`oxlint-tsgolint` 7.0.2003, and Oxfmt 0.71.0. The workspace's installed dependency
set requires Node 22.19 or newer; CI uses Node 24. Platform imports are focused so
filesystem users do not eagerly load unrelated Node HTTP implementations.

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run typecheck:consumers
bun run typecheck:examples
bun run lint
bun run format:check
bun run test
```

`typecheck` emits declarations for the project-reference graph without emitting
JavaScript, avoiding TypeScript 7's aggregate `--build --noEmit` restriction.
Sandbox integration requires a host hard file-descriptor limit of at least
65,535. This cloud workspace is capped at 16,384, so exact-commit CI on the
configured isolated runners supplies real-chain integration evidence. Local
process/download lifecycle fixtures are separate evidence and are not presented
as real-chain tests.
