# NEAR next: independent SDK candidate

A private ground-up candidate for exact protocol reads, public data and caller-owned Effect workflows. It does not replace the published SDK. Signing, custody, authentication and transaction/reconciliation workflows remain outside the current implementation; see [coverage](COVERAGE.md).

Protocol u64/u128 quantities are exact bigint values. Arbitrary contract JSON numbers still use ordinary JavaScript JSON semantics. Use `viewBytes` for a different contract decoder. JSON objects follow the native parser’s last-member-wins behavior for duplicate names.

## Run a first read

From this source directory:

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

In a consumer project, install the tarball and the pinned Effect version:

```sh
npm install /path/to/near-kit-next-0.0.0-experimental.1.tgz effect@4.0.0-rc.118
```

```ts
import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"

const client = Near.make({ url: "https://rpc.testnet.near.org" })
const program = Near.account(client, "alice.testnet").pipe(
  Effect.provide(Near.fetchLayer),
)
const account = await Effect.runPromise(program)
console.log(account.amount.toString())
```

Choose an account that exists on your node. The runnable CLI reads one block and pins the account to its hash:

```sh
node --experimental-strip-types examples/read.ts RPC_URL ACCOUNT_ID
```

Packed consumers must copy TypeScript out of node_modules before native Node execution:

```sh
cp node_modules/@near-kit/next/examples/read.ts ./read.mts
node --experimental-strip-types read.mts RPC_URL ACCOUNT_ID
```

## Runtime and imports

Node 22.12+ and modern browsers are the target. Exact wire decoding requires native JSON source context, rawJSON and isRawJSON (feature floors: Chrome 114, Firefox 135, Safari 18.4). Missing/incomplete features fail with UnsupportedError before I/O. Actual tested engine versions are recorded separately; feature availability is not a platform acceptance claim. Effect 4.0.0-rc.118 and its HTTP API are prerelease/unstable dependencies, deliberately pinned.

Strict browser-only TypeScript consumers need ESNext.Disposable alongside ES2022/DOM libs. Core and pure-subpath consumers are checked without Node globals. The optional WalletSelector 10.1.4 examples use Bundler module resolution and type-only @types/node because its declarations contain extensionless ESM imports and Buffer. Two upstream declarations also reference unexported @near-js/types paths. The supplied optional-example config maps those exact type-only imports to the real installed declarations. These requirements do not add runtime Node polyfills, ambient any types or skip library checking.

Use Effect module imports, as above. `/data` and `/units` have no Effect runtime imports; the package still installs its declared Effect dependency. `/operator` contains optional named operator summaries, sharing the same internal HTTP boundary.

## One execution model

`make` snapshots configuration. It has no methods, runtime, active network selection or transport to close. Named functions return native Effects and resolve the standard HttpClient when executed:

- account, block, status: exact quantities and explicit node-reported metadata
- view, viewBytes: schema-validated contract JSON or explicit bytes; JSON/byte arguments are independent of result mode
- accessKey, accessKeys, gasKeyNonces: permission and exact nonce inspection, without allocation/signing
- code, globalCode: owned WASM bytes and advertised code hash
- statePage, statePages: byte-oriented storage and pull-based snapshot traversal
- gasPrice: an exact price with a required block identifier or explicit `latest`

Finality-capable reads default to final. Select optimistic, near-final, `{ hash }` or `{ height: 0n }` explicitly. Resolve one block and reuse its hash across related reads. A node's metadata is not consensus verification.

State pagination follows the tested nearcore 2.13.4 contract: one pinned block, strict byte-order progress, bounded responses and no prefetch. Empty-byte cursors are valid. Proof material is unverified and cannot be requested with pagination. A caller's take/deadline produces a partial traversal, not proof of exhaustion. Newer key-list continuation is rejected explicitly instead of being silently discarded.

## Failures and lifetime

```ts
signal.throwIfAborted()
await Effect.runPromise(
  Near.account(client, accountId).pipe(
    Effect.catchTag("AccountNotFound", () => Effect.succeed(undefined)),
    Effect.timeout("5 seconds"),
    Effect.provide(Near.fetchLayer),
  ),
  { signal },
)
```

Keep the entry guard: the pinned Effect runner starts evaluating before checking an already-aborted signal. After starting, interruption reaches the full request/body scope. No hidden retries, polling, caches or detached runtime are added. A synchronous parser or non-cooperative user transport is not preemptible.

Expected failures are RequestError, TransportError, HttpError, DecodeError, RpcError, UnsupportedError, AccountNotFound and AccessKeyNotFound. A missing access key does not prove its account exists; unavailable gas-key lanes can mean an ordinary non-gas key. Empty key lists do not establish account existence. Defects and interruption remain native Effect causes.

Missing-key detection supports both structured RPC errors and the exact pinned nearcore legacy result formatter; unfamiliar legacy text stays an unknown RPC failure. Expected diagnostics omit provider text, credentials and raw causes. Operations create no automatic spans and suppress standard HTTP tracing even with a borrowed client. Explicit caller middleware/tracing remains caller-owned. The supplied fetchLayer rejects redirects; an explicitly configured custom client keeps its own policy.

Response bytes default to a 2 MiB cap, configurable with a finite positive safe integer. This is not a total heap/CPU cap. Request inputs are copied at each execution; immutable inputs are required for retry-stable values.

[Design](DESIGN.md) · [coverage and current evidence](COVERAGE.md) · [historical five-read evaluation](EVALUATION.md)

## Application recipes

- [Snapshot export](examples/snapshot-export.ts): `node --experimental-strip-types examples/snapshot-export.ts RPC_URL ACCOUNT_ID OUTPUT.ndjson`. Pins all reads, writes exact decimal strings/tagged base64, and publishes only after natural traversal and file close. Existing files are never overwritten. Before publication, failure leaves `.partial`. Interruption during the short publication step can leave a valid final export; cleanup failure can leave both names. Publication requires same-filesystem hard links. Unavailable account code is an explicit status.
- [Polling](examples/poll-account.ts): five sequential final-account samples, with caller-owned cancellation and at most two retries for transport failures. Repeated blocks are allowed; this is not a history subscription.
- [Full wire inspection](examples/raw-inspection.ts): explicit official block/chunk/genesis/config reads stream the original bytes to stdout. No claim of typed raw fields or JSON-RPC success is made; a truncated output is partial.
- [Wallet observation](examples/wallet-selector-observation.ts), [plain React](examples/wallet-account.tsx) and [React Query](examples/wallet-query.tsx): supply an already-created selector and an immutable application read source. No connection or write action is performed. The app owns QueryClientProvider and wallet setup/error UI.

For the optional wallet recipes, copy the three `wallet*.ts/tsx` files and `examples/tsconfig.wallet.json` into your project root, then install the pinned example dependencies:

```sh
npm install @near-wallet-selector/core@10.1.4 @tanstack/react-query@5.104.0 react@19.2.7 react-dom@19.2.7
npm install --save-dev typescript@7.0.2 @types/node@24.19.0 @types/react@19.2.17 @types/react-dom@19.2.3
npx tsc -p tsconfig.wallet.json
```

Keep sourceKey non-secret and advance source.revision when endpoint credentials or chain context changes. Configured wallet network is not current observed network; only selected-wallet events update knowledge, and delayed same-wallet events cannot be proved fresh. A known mismatch suspends reads. Mocked observation/browser fixtures do not establish real extension/mobile/hardware compatibility.
