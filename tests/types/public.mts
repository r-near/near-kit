// Compile-only consumer contract. Never execute this fixture.
import {
  Near,
  InMemoryKeyStore,
  RotatingKeyStore,
  TransactionBuilder,
  generateKey,
  parseKey,
  verifyNep413Signature,
  type Contract,
  type FinalExecutionOutcome,
  type KeyStore,
  type PrivateKey,
  type WalletConnection,
} from "near-kit"
import { FileKeyStore } from "near-kit/keys/file"
import { NativeKeyStore } from "near-kit/keys/native"
import { Sandbox, EMPTY_CODE_HASH, type StateSnapshot } from "near-kit/sandbox"
import { AccountIdSchema, AmountSchema } from "near-kit/schemas"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Must<T extends true> = T
export type ViewReturn = Must<Equal<ReturnType<Near["view"]>, Promise<unknown>>>
export type BalanceReturn = Must<
  Equal<ReturnType<Near["getBalance"]>, Promise<string>>
>
export type SignReturn = Must<
  Equal<
    ReturnType<Near["signMessage"]>,
    Promise<Awaited<ReturnType<Near["signMessage"]>>>
  >
>
export function consume(
  key: PrivateKey,
  wallet: WalletConnection,
  snapshot: StateSnapshot,
) {
  const store: KeyStore = new InMemoryKeyStore({ "alice.near": key })
  const near = new Near({
    network: "testnet",
    keyStore: store,
    defaultSignerId: "alice.near",
    defaultWaitUntil: "FINAL",
    retryConfig: { maxRetries: 0 },
    wallet,
  })
  const view: Promise<string | undefined> = near.view<string>(
    "counter.near",
    "read",
    {},
    { finality: "final" },
  )
  const call: Promise<FinalExecutionOutcome> = near.call(
    "counter.near",
    "write",
    {},
    { attachedDeposit: "1 NEAR", gas: "30 Tgas" },
  )
  const balance: Promise<string> = near.getBalance("alice.near")
  const tx = near
    .transaction("alice.near")
    .transfer("bob.near", "1 NEAR")
    .nonce(42n)
    .strictNonceMode()
  const detached = new TransactionBuilder("alice.near", near.rpc, store)
  const delegateBytes: Promise<Uint8Array> = detached
    .transfer("bob.near", "1 NEAR")
    .delegate({ nonce: 42n, maxBlockHeight: 100n, payloadFormat: "bytes" })
    .then((x) => x.payload)
  const iterator: AsyncGenerator<{ key: string; value: string }> =
    near.viewStateAll("contract.near", { limit: 10 })
  const calls = near.contract<
    Contract<{
      view: { get: () => Promise<number> }
      call: { set: (args: { value: number }) => Promise<void> }
    }>
  >("contract.near")
  const changed: Promise<void> = calls.call.set(
    { value: 1 },
    { gas: "30 Tgas" },
  )
  const file = new FileKeyStore("/tmp/creds", "testnet")
  const native = new NativeKeyStore("NEAR Test")
  const rotating = new RotatingKeyStore({ "alice.near": [key] })
  const keyPair = parseKey(key)
  const add: Promise<void> = file.add("alice.near", keyPair, {
    seedPhrase: "words",
    derivationPath: "path",
    implicitAccountId: "id",
  })
  const status = near.rpc.getTransactionStatus("hash", "alice.near", "NONE")
  const sandbox = Sandbox.start({
    binaryPath: "/tmp/sandbox",
    detached: false,
  }).then(async (s) => {
    await s.restoreState(snapshot)
    await s.stop()
  })
  const verify: Promise<boolean> = verifyNep413Signature(
    { accountId: "alice.near", publicKey: "key", signature: "sig" },
    { message: "message", recipient: "app.near", nonce: new Uint8Array(32) },
    { near, nonceValidation: "none" },
  )
  return {
    view,
    call,
    balance,
    tx,
    delegateBytes,
    iterator,
    changed,
    file,
    native,
    rotating,
    add,
    status,
    sandbox,
    verify,
    EMPTY_CODE_HASH,
    AccountIdSchema,
    AmountSchema,
    generateKey,
  }
}
