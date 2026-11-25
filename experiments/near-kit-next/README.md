# NEAR next: SDK rewrite in progress

A private ground-up candidate for exact protocol reads, public data and caller-owned Effect workflows. It does not replace the published SDK. The full workflow goal remains open; signing/custody and transaction/reconciliation work is paused, while independent public-data/authentication work is tracked separately; see [coverage](COVERAGE.md).

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

Node 22.12+ and modern browsers are the target. Deno 2.9.7 and Bun 1.4.2 passed the packed read-client checks on Linux x64; final optional-module coverage is recorded separately. Exact wire decoding requires native JSON source context, rawJSON and isRawJSON (feature floors: Chrome 114, Firefox 135, Safari 18.4). Missing/incomplete features fail with UnsupportedError before I/O. Actual tested engine versions are recorded separately; feature availability is not a platform acceptance claim. Effect 4.0.0-rc.118 and its HTTP API are prerelease/unstable dependencies, deliberately pinned.

Strict browser-only TypeScript consumers need ESNext.Disposable alongside ES2022/DOM libs. Core and pure-subpath consumers are checked without Node globals. The optional WalletSelector 10.1.4 examples use Bundler module resolution and type-only @types/node because its declarations contain extensionless ESM imports and Buffer. Two upstream declarations also reference unexported @near-js/types paths (tested at 2.5.1; install it directly for the supplied paths). The supplied optional-example config maps those exact type-only imports to the real installed declarations. These requirements do not add runtime Node polyfills, ambient any types or skip library checking.

Public key/hash parsing validates canonical encoding and byte length, not key mathematics or proof validity. Use Effect module imports, as above. `/data` and `/units` have no Effect runtime imports; the package still installs its declared Effect dependency. `/operator` contains optional named operator summaries, sharing the same internal HTTP boundary.

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

[Design](DESIGN.md) · [coverage and current evidence](COVERAGE.md) · [current evaluation](EVALUATION.md)

## Application recipes

- [Snapshot export](examples/snapshot-export.ts): `node --experimental-strip-types examples/snapshot-export.ts RPC_URL ACCOUNT_ID OUTPUT.ndjson`. Pins all reads, writes exact decimal strings/tagged base64, and publishes only after natural traversal and file close. Existing files are never overwritten. Before publication, failure leaves `.partial`. Interruption during the short publication step can leave a valid final export; cleanup failure can leave both names. Publication requires same-filesystem hard links. Unavailable account code is an explicit status.
- [Polling](examples/poll-account.ts): five sequential final-account samples, with caller-owned cancellation and at most two retries for transport failures. Repeated blocks are allowed; this is not a history subscription.
- [Full wire inspection](examples/raw-inspection.sh): `sh examples/raw-inspection.sh RPC_URL block BLOCK_HASH` delegates explicit official block/chunk/genesis/config reads to curl >=8.4 (POSIX shell). Original bytes stream to stdout with curl’s HTTP(S), 15-second network-transfer and 16 MiB limits. A stalled stdout sink can exceed the network-transfer budget; interrupt curl to stop it, or apply your own external wall-clock supervisor. curl owns interruption/backpressure; its diagnostics and exit codes apply. No user curlrc, redirect following or retries are used. No claim of typed raw fields or JSON-RPC success is made; a truncated output is partial.
- [Wallet observation](examples/wallet-selector-observation.ts), [plain React](examples/wallet-account.tsx) and [React Query](examples/wallet-query.tsx): supply an already-created selector and an immutable application read source. No connection or write action is performed. The app owns QueryClientProvider and wallet setup/error UI.

For the optional wallet recipes, copy the three `wallet*.ts/tsx` files and `examples/tsconfig.wallet.json` into your project root, then install the pinned example dependencies:

```sh
npm install @near-wallet-selector/core@10.1.4 @tanstack/react-query@5.104.0 react@19.2.7 react-dom@19.2.7
npm install --save-dev @near-js/types@2.5.1 typescript@7.0.2 @types/node@24.19.0 @types/react@19.2.17 @types/react-dom@19.2.3
npx tsc -p tsconfig.wallet.json
```

Keep sourceKey non-secret and advance source.revision when endpoint credentials or chain context changes. Configured wallet network is not current observed network; only selected-wallet events update knowledge, and delayed same-wallet events cannot be proved fresh. A known mismatch suspends reads. Mocked observation/browser fixtures do not establish real extension/mobile/hardware compatibility.

## Public deterministic addresses

`@near-kit/next/address` exports one synchronous `deterministicAccountId` function for NEP-616 V1. It consumes an exclusive `{ hash }` or `{ accountId }` global-code reference and optional storage entries as `[Uint8Array, Uint8Array]` tuples. These are exact initial storage bytes, not JSON method arguments. Duplicate equal-byte keys, malformed references, detached bytes and shared backing are rejected with TypeError/RangeError. Inputs must stay stable while the call captures them; arbitrary caller getters/proxies remain caller code.

```ts
import { deterministicAccountId } from "@near-kit/next/address"
const expected = deterministicAccountId({
  code: { accountId: "publisher.near" },
  data: [],
})
console.log(expected) // 0s2293da2d32cd0a067950616036ff973884abab0a
```

The calculation is network-independent and does not establish account existence, ownership, current code/state or deployability. The publisher's referenced code can change. The offline `examples/address.ts` demonstrates both reference forms and invalid input handling; copy packed TypeScript into your project before native Node execution. This subpath imports the pinned Keccak implementation, with no Effect runtime; other subpaths do not import it. The package installs the hash dependency even if the subpath is unused.

## Server render to browser hydration

Copy `examples/ssr-account.tsx`, `ssr-account-server.tsx` and `ssr-account-client.tsx` into your application. The server uses one request-owned query cache; the browser validates a bounded decimal/hash payload before hydrating its own cache. The page makes one server read, preserves exact values, and refreshes only when requested. Every source key must identify the same immutable RPC configuration on server and browser. Matching document attributes catches accidental swaps, not authentication.

Use the same React/Query versions above. These three files need no wallet connector or wallet-specific type mappings:

```sh
npx tsc --ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext --jsx react-jsx --strict --types node --rootDir . --lib ES2022,DOM,DOM.Iterable,ESNext.Disposable --outDir app-dist ssr-account.tsx ssr-account-server.tsx ssr-account-client.tsx
```

Your Fetch-compatible route returns the response from `accountPageResponse(request, { source, accountId, browserModule: "/account.js" })`. The incoming request signal controls the read and suppresses publication after cancellation. On the browser side, bundle this entry as `/account.js`:

```tsx
import * as Near from "@near-kit/next"
import { hydrateAccountPage } from "./ssr-account-client.js"
const source = {
  key: "testnet-public",
  client: Near.make({ url: "https://rpc.testnet.near.org" }),
}
const page = hydrateAccountPage(document, { [source.key]: source })
// Register page.dispose with your router's unmount lifecycle.
// After loading a newer trusted page, page.render(nextDocument) changes identity.
```

The router owns navigation request ordering. It must discard older navigation responses, as the complete local demo does. Failed reads remain service errors rather than successful empty pages. The route emits `private, no-store`; application error middleware owns the HTTP error response.

For a complete runnable local demonstration from this checkout, run `npm run build` followed by `node scripts/browser-server.mjs` and open `http://127.0.0.1:4177/ssr?account=alice.testnet&source=one`. Its loopback RPC is a deterministic test fixture, not chain evidence. The same shipped server/client examples run in the browser matrix.

## Deliberate external boundaries

Wallet setup, connection dialogs, restoration, sign-out and signing remain owned by the selected wallet connector. The supplied observation recipe targets WalletSelector 10.1.4; it does not claim near-connect/HotConnect compatibility. Applications migrating those adapters can retain their existing connector and expose its own account/source state to the ordinary read/query recipes, or choose WalletSelector. Actual connection/signing remains a distinct acceptance item in the full goal, not something proved by a mock observation store.

Sandbox patching, fast-forward and whole-node dump/restore are deliberately outside this SDK's API. They belong to node/test infrastructure. The checked-in pinned Docker recipe provisions and tears down public static-genesis read fixtures; it does not replace whole-node backups or manufacture transaction history. The account snapshot exporter exports public account data, not a restorable node database.

## Public NEP-413 proofs and application receipts

`@near-kit/next/nep413` exports synchronous `verifyNep413Signature(payload, proof)`. It checks a public signature over the exact stored message, 32-byte nonce, recipient and optional callback URL. It supports canonical Ed25519 and low-S secp256k1 proofs; ML-DSA is explicitly unsupported by this authentication profile. The complete envelope is capped at 64 KiB. Invalid encodings throw Nep413InputError, unsupported recognized keys throw Nep413UnsupportedKeyError, and a well-formed invalid proof returns false. A true result does not authenticate an account, select a chain, consume a challenge or create a session.

```ts
import { verifyNep413Signature } from "@near-kit/next/nep413"
const valid = verifyNep413Signature(storedChallenge.payload, {
  publicKey: returnedProof.publicKey,
  signature: returnedProof.signature,
})
```

The complete `examples/authentication-server.ts` owns its challenge/session maps and cookie binding. It verifies the exact server-issued payload, explicitly awaits a final accessKey read, accepts FullAccess or GasKeyFullAccess, and rechecks expiry/current challenge before one synchronous consume-and-session commit. RPC failure is a service failure; it is not reported as invalid credentials. Disconnect or the five-second receipt deadline aborts the authority read and leaves an unconsumed challenge retryable. A lost response after the commit can still mean a session was created.

Run this Node loopback demonstration from the checkout after building the package:

```sh
npx tsc --ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --lib ES2022,DOM,DOM.Iterable,ESNext.Disposable --rootDir . --outDir .receipt-build examples/authentication-server.ts
node .receipt-build/examples/authentication-server.js
```

It exposes POST /challenge, POST /receipt and GET /me at http://127.0.0.1:8787 with same-origin checks. Its source is fixed to the configured testnet endpoint. Keep cookies between challenge and receipt; submit only a proof for that exact challenge. The checked-in disposable public fixtures exercise the entire flow against an isolated local RPC, including replay races, expiry, held-body timeout and account permissions. They carry no user wallet authority.

This is a single-process application example with bounded in-memory maps and one-hour sessions. A deployed application owns HTTPS/secure-cookie policy, shared atomic storage, rate limits and session revocation. Copying the cryptographic helper alone is not a login system. The package introduces no production signer or custody API. Other entrypoints do not import the verifier, although its pinned crypto dependencies are installed with the package.
