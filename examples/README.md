# near-kit Examples

Minimal, copy-paste ready examples for common NEAR operations.

## Examples

### [`quickstart.ts`](./quickstart.ts)

Essential operations: view, call, send, type-safe contracts, transaction builder.
Start here if you're new to near-kit.

```bash
bun run examples/quickstart.ts
```

### [`wallet-browser.ts`](./wallet-browser.ts)

Connect to user wallets in the browser with NEAR Connect.

### [`meta-transactions.ts`](./meta-transactions.ts)

Gasless transactions (NEP-366): user signs, relayer pays.
Shows both user and relayer sides.

### [`sign-in-with-near.ts`](./sign-in-with-near.ts)

Gasless authentication using message signing (NEP-413).
Client signs, server verifies.

### [`universal-code.ts`](./universal-code.ts)

Same API works everywhere: server with private keys, browser with wallets.
Write once, run anywhere.

### [`rotating-keystore.ts`](./rotating-keystore.ts)

High-throughput concurrent transactions using multiple access keys.
Send many transactions without nonce collisions.

```bash
bun run examples/rotating-keystore.ts
```

## Setup

Most examples require credentials:

```bash
export NEAR_ACCOUNT_ID=your-account.testnet
export NEAR_PRIVATE_KEY=ed25519:...
```

Get a testnet account at [wallet.testnet.near.org](https://wallet.testnet.near.org/)

## Documentation

Full docs: [kit.near.tools](https://kit.near.tools)

## Effect experiment

`effect.ts` demonstrates the optional `near-kit/effect` entrypoint and explicit
RPC/key/nonce layer injection. Importing that example does not perform I/O.
Run `bun run typecheck:examples` from the repository root to check every example.
The Promise examples use the public workspace package imports, so build the
packages before running them. Only run value-moving examples with accounts and
funds you deliberately intend to use; validation does not execute those examples.

### Paired scoped workflows

[`workflow-native.ts`](./workflow-native.ts) and
[`workflow-promise.ts`](./workflow-promise.ts) perform the same finite work:
stream paged contract state, read contract methods with bounded concurrency,
and submit locally signed transfers across several signing keys. The shared
[`WorkflowInput`](./workflow-common.ts) specifies the accounts, receiver,
work size and concurrency limit. Importing these files performs no I/O.

The native example consumes `Client` from one provided `Client.layer` graph.
Supply its RPC, key storage and nonce reservation layers once around the whole
workflow. The Promise example's `runPromiseWorkflow(clientLayer, input)` owns
one application `ManagedRuntime`, acquires the same client, projects it with
`Near.fromClient`, and disposes the runtime in `finally`. Applications which
already own that lifetime can call `promiseWorkflow(near, input)` directly.
All clients signing with the same keys must share one nonce reservation domain.

Run the examples against the included local transport without credentials,
network requests or real assets:

```bash
bun run build
bun run --filter near-kit test -- tests/unit/workflow-examples.test.ts
```

The workflow test consumes 128 state rows and 24 reads, signs 16 transfers with
disposable Ed25519 keys, independently verifies the wire signatures, and loses
one response after admission. Both examples reconcile the original hash without
creating a replacement commitment, bound concurrent requests, and release the
provided capabilities. The fixture implements the example `get_status` method;
adapt the contract method and input to your application. The examples use
`waitUntil: "NONE"`, so returned admission is not final chain confirmation.

Native operations retain the caller's service context and trace, and their
fibers can interrupt sibling reads and run finalizers on failure. Ordinary
Promise methods have no `AbortSignal` option and start independent runtime
boundaries. This Promise example therefore waits for already-started work
before disposal. For explicit cancellation or inherited tracing, compose native
operations and pass a signal at your application's `Effect.runPromise` boundary.
The owner tests exercise both failure paths and trace parentage through the
injected native signer, nonce reservation, RPC and reconciliation operations.
