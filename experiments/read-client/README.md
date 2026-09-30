# NEAR read experiment

This private prototype tests whether five native Effect reads can replace a larger client/runtime hierarchy. It adds no signing, wallet UI, custody, transaction or React package. Existing near-kit packages are unchanged.

It uses the prerelease Effect 4.0.0-rc.118. It is not published or a complete near-kit replacement.

## Try it

From this directory in the source checkout (not inside node_modules):

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

In a separate consumer project, install the resulting tarball and the Effect version used by its examples:

```sh
npm install /path/to/near-kit-read-experiment-0.0.0-experimental.0.tgz effect@4.0.0-rc.118
```

All examples import that private package, not published `near-kit`.

```ts
import { Effect, Schema } from "effect"
import { Near } from "@near-kit/read-experiment"

const near = Near.make({ url: "https://rpc.testnet.near.org" })
const account = await Effect.runPromise(
  near.account("alice.testnet").pipe(Effect.provide(Near.fetchLayer)),
)
console.log(account.amount) // exact bigint yoctoNEAR

const balance = near.view({
  accountId: "token.testnet",
  method: "ft_balance_of",
  args: { account_id: "alice.testnet" },
  schema: Schema.String,
})
```

The example accounts/contracts must exist on your selected node. For a complete account/block workflow with a chosen endpoint and account:

```sh
node --experimental-strip-types examples/read.ts RPC_URL ACCOUNT_ID
```

Packed consumers should copy the example into their own project first. Node does not strip TypeScript inside node_modules:

```sh
cp node_modules/@near-kit/read-experiment/examples/read.ts ./read.mts
node --experimental-strip-types read.mts RPC_URL ACCOUNT_ID
```

For strict browser-only TypeScript projects without Node globals, include `ESNext.Disposable` alongside your target/DOM libs; Effect rc.118 declarations use the explicit resource-management types.

## One execution model

`make` only snapshots configuration. Its five methods return lazy Effects and borrow the standard Effect HttpClient when executed:

- `account(id, { at? })`: exact amount/locked bigint, storage/code information and block metadata
- `block(at?)`: block hash, safe-integer height and exact nanosecond timestamp
- `status()`: node-reported chain/protocol and latest block metadata
- `view({ accountId, method, args?, at?, schema })`: validated JSON value, logs and block metadata
- `viewBytes({ accountId, method, args?, at? })`: bytes, logs and block metadata

Both view methods accept JSON-object or byte arguments independently of output format. JSON views require a schema; `Schema.Unknown` deliberately returns unknown. Empty bytes are valid binary output, but empty/malformed JSON is a decoding failure. There is no generic type assertion or text fallback.

Reads default to `final`. Select `optimistic`, `near-final`, `{ hash }` or `{ height }` explicitly. Two independent final reads can observe different blocks. Resolve a block once and pass its hash to related reads; returned metadata must match. Metadata does not cryptographically verify a node.

## Cancellation and failures

```ts
signal.throwIfAborted()
const result = await Effect.runPromise(
  near.account(accountId).pipe(
    Effect.timeout("5 seconds"),
    Effect.provide(Near.fetchLayer),
  ),
  { signal },
)
```

Keep the first line: Effect rc.118 starts evaluating before it checks an already-aborted `runPromise` signal. The explicit application-entry check prevents starting that read. The adapter does not patch Effect's runner. After execution starts, interruption reaches the request and its complete response body.

Expected failures are `RequestError`, `TransportError`, `HttpError`, `DecodeError`, `RpcError` and `AccountNotFound`. Catch only the failures your application can handle. Defects and interruption remain Effect causes. A legacy result-level contract error has no fabricated RPC code.

There is no automatic retry, caching, polling or owned runtime. Use Effect operators in the application. A timeout requests interruption; it cannot preempt synchronous user code or force a non-cooperative transport to stop.

## Boundaries

- Response bodies are limited to 2 MiB by default; `maxResponseBytes` accepts a finite positive safe integer
- Amounts/locked values are validated u128 decimals; timestamps are u64 decimals. Other retained numeric fields must be safe integers. Arbitrary contract JSON numbers retain JavaScript precision limits
- Expected errors omit provider text, URLs, headers and raw causes. Library operations create no automatic spans and disable built-in HTTP tracing. Explicit caller tracing/custom middleware remains caller-owned
- `Near.fetchLayer` rejects redirects. Other clients or explicit Fetch configuration retain their own policy; the adapter does not overwrite borrowed settings
- Configuration is copied at construction. Request arguments are copied/encoded at each execution before transport starts; use immutable inputs when retrying
- The browser recipe accepts an application-owned wallet selection with a revision token. It does not connect a wallet or prove extension/mobile compatibility

See [design choices](DESIGN.md), [the browser recipe](examples/account-balance.tsx), and the local test commands. Real-node/browser/measurement evidence must be read separately; unit tests are not protocol evidence.
