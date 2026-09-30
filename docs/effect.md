# Effect-native API

The familiar `near-kit` Promise API and `@near-kit/react` APIs share a native
Effect implementation. The optional `near-kit/effect` entrypoint exposes
composable programs, typed failures, services, layers and streams. This branch
pins Effect `4.0.0-rc.118`, a prerelease, and is not yet a published release.

## Existing applications

```ts
import { Near } from "near-kit"

const near = new Near({ network: "testnet" })
const balance = await near.getBalance("alice.testnet")
```

Existing fluent transactions, contracts, wallet connectors, key-store interfaces,
error classes, explicit nonces, and wire encodings are retained. Use explicit
transport and service injection for customization; arbitrary mutation of built-in
methods is not a supported interception mechanism. Internal `NonceManager` and
the old RPC implementation class have been removed. The only Promise conversions are
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

## Transaction values

Native transactions are data plans rather than a second fluent builder. The
public `near.transaction(...).transfer(...).send()` API stays unchanged.

```ts
import * as Effect from "effect/Effect"
import { Actions, Near, transactionPlan } from "near-kit/effect"

const program = Effect.gen(function* () {
  const near = yield* Near
  const plan = transactionPlan({
    signerId: "alice.testnet",
    receiverId: "bob.testnet",
    actions: [Actions.transfer(10n ** 24n)], // one NEAR, in yoctoNEAR
  })
  const signed = yield* near.transactions.sign(plan)
  return { hash: signed.hash, bytes: signed.serialize() }
})
```

`near.transactions` provides `build`, `sign`, `send`, `broadcast`, `delegate` and
`delegateV2`. Native `build` returns a version-tagged unsigned snapshot:
`{ version: 0, transaction }` or `{ version: 1, transaction }`. It honors strict
and gas-slot nonce modes. A later `sign(plan)` performs fresh preparation; build
is not an implicit build-to-sign handoff. The public builder's `build()` keeps its
historical shape. Delegate options separately own delegate nonce, expiry and slot;
ordinary transaction mode fields do not implicitly select a delegate format.

Signing returns a stable signed commitment without broadcasting;
`broadcast(signed)` uses its captured bytes. `send(plan)` signs once per execution
and never replaces submitted bytes with a fresh nonce. Each execution snapshots
its inputs. Returned unsigned data and serialized bytes do not alias builder or
signed state. Editing a public builder invalidates its signature cache, including
pending completions for the old plan.

### Submission safety

Automatic fresh-nonce recovery has deliberately been removed. This changes
recovery behavior while retaining the simple API shape. A matching `InvalidNonce`
response proves only that a replay was rejected: a browser, proxy or transport may
already have retried accepted bytes without exposing the lost response to the SDK.
No nonce rejection is permission to sign a second economic operation.

Transport retries retain the exact signed bytes. High-level submissions reconcile
nonce rejections and ambiguous failures by the original hash. A matching status
returns the original transaction; missing/unavailable status or conflicting
transaction metadata raises `TRANSACTION_OUTCOME_UNKNOWN` with `retryable: false`
and the hash, sender and original cause in `error.data`. An unknown status on a
lagging node never proves non-execution.

Retain a native signed value and deliberately reuse `broadcast(signed)` for
same-byte replay. Reusing the same unedited public builder also retains its signed
commitment, including concurrent local `sign()`/`send()` calls. Failed signing
acquisition is cleared so a later pre-submission attempt can succeed. In contrast, rerunning `send(plan)`, applying `Effect.retry` to it, or
calling `near.send(...)` again creates a new commitment. Do not do that blindly
after uncertainty or interruption. Check the original hash; interruption cannot
undo a submitted transaction. Editing a builder also represents a new intent.

Automatic local sends sharing a nonce service are sequenced per account, key and
nonce slot from reservation through signing and the requested submission result.
Different keys and slots remain concurrent. `NONE` still means acknowledgment,
not confirmed node admission; use an inclusion/execution wait level when ordering
matters. Explicit nonces and offline/pre-signed commitments remain caller-managed:
the SDK cannot reorder independently prepared transactions after signing.

A wallet connector owns its own signing and submission. The SDK cannot coalesce
opaque `wallet.signAndSendTransaction` calls or infer whether a wallet failure
submitted anything; use the wallet's recovery contract rather than blindly
repeating an approval or submission.

A native `TransactionSigner` returns an Effect and stays in the caller's fiber.
Resolve any application services before supplying it through native runtime
configuration or a plan. Promise signers are adapted only at the public boundary.
Pure action factories, amount parsing and cryptographic/wire algorithms stay
synchronous; native execution classifies expected input/encoding failures in its
failure channel. Use `Effect.all` for native concurrency; public `near.batch`
only joins the Promises it receives.

## Optional Effect HTTP integration

Ordinary clients use the lightweight fetch transport. Applications with an Effect
HTTP stack can explicitly provide the optional adapter and its middleware:

```ts
import * as Layer from "effect/Layer"
import { FetchHttpClient } from "effect/http"
import { Rpc, rpcTransportHttpClient } from "near-kit/effect"

const rpc = Rpc.layer({ url: "https://rpc.testnet.near.org" }).pipe(
  Layer.provide(rpcTransportHttpClient),
  Layer.provide(FetchHttpClient.layer),
)
```

## Native message verification

`verifyNep413Signature` from `near-kit/effect` accepts the native client's narrow
`getAccessKey` capability. Custom readers retain their Effect service requirements;
verification does not run a nested Promise client or discard the caller's context.

```ts
import { Near, verifyNep413Signature } from "near-kit/effect"

const verify = Effect.gen(function* () {
  const near = yield* Near
  return yield* verifyNep413Signature(signedMessage, messageParams, { near })
})
```

A supplied reader must confirm that the signed account/key currently has
`FullAccess` permission. Invalid signatures, expired nonces, rejected reads and
missing or restricted keys return `false`; interruption still propagates. Omit the
reader only when offline cryptographic verification is sufficient. The root
Promise helper continues to accept `{ near: new Near(...) }`.

## Errors and public boundaries

Native operations retain SDK domain error classes, use native `SchemaError`
for invalid config, RPC data, and root validation-helper inputs, and use `ExternalError` for failures
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

React consumes the native programs owned by its `Near` client. Superseded and
unmounted read requests are interrupted. React owns visible state; one Effect
fiber owns each active read and its resource finalizers. Mutation Promises retain their own results, while only the
newest active request can update the mounted UI. Unmounting disconnects UI state;
it does not pretend to undo a submitted transaction. Replacing a configured signer,
key store, or wallet takes effect by object/function identity; authority-bearing
config is never retained solely because its JSON representation is unchanged.

## Validation compatibility

Existing Zod schemas under `near-kit/schemas` and credential schemas under
`near-kit/keys` remain genuinely Zod-composable. Their runtime imports are isolated
from the root and native core entrypoints. Native RPC codecs
use one Effect Schema owner and preserve accepted wire defaults and unknown-field
behavior. Internal config/RPC diagnostics no longer replay a duplicate Zod
decoder. Node credential storage uses the existing credential codec at its Effect
I/O boundary. Amount, Borsh, crypto and signed-transaction commitments are covered
by independent unchanged vectors. A `keyStore` must be a real store or account-key
record; a path string is rejected. For file storage, supply `FileKeyStore` from
`near-kit/keys/file`.

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
bun run typecheck:browser
bun run lint
bun run format:check
bun run test
```

`typecheck` emits declarations for the project-reference graph without emitting
JavaScript, avoiding TypeScript 7's aggregate `--build --noEmit` restriction.
Sandbox integration requires a host hard file-descriptor limit of at least
65,535. Process/download lifecycle fixtures do not substitute for real-chain
integration tests.

Browser E2E tests import the built packages and exercise real HTTP, browser crypto,
and React UI lifecycles against an isolated local RPC fixture. All signing keys
are disposable; the fixture never connects to a public network or moves assets.
The CI matrix runs Chromium, Firefox and WebKit with React 18 and 19, and retains
traces, screenshots and video for failures.

```sh
bunx playwright install --with-deps
bun run test:browser
# Repeat the Chromium lifecycle suite when changing cancellation or ownership:
bun run test:browser --project=chromium-react18 --project=chromium-react19 --repeat-each=5
```

The prepare command uses `effect-tsgo patch --oxlint --no-force`: the pinned
`@effect/tsgo` CLI requires an explicit value for its deprecated force option.
`--no-force` keeps compatibility validation enabled.
