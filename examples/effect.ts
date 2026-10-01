/** Native Effect entrypoint. Programs are lazy; importing this file does no I/O. */
import { Effect, Layer } from "effect"
import { InMemoryKeyStore, type Contract } from "near-kit"
import {
  Actions,
  KeyStore,
  Near,
  NonceReservation,
  Rpc,
  transactionPlan,
} from "near-kit/effect"

export const readAccount = Effect.gen(function* () {
  const near = yield* Near
  return yield* near.getAccount("alice.testnet")
}).pipe(Effect.provide(Near.layer({ network: "testnet" })))

type Counter = Contract<{
  view: { get_count: () => Promise<number> }
  call: { increment: (args: { by: number }) => Promise<void> }
}>

export const readCounter = Effect.gen(function* () {
  const near = yield* Near
  const counter = near.contract<Counter>("counter.testnet")
  return yield* counter.view.get_count()
})

/** Explicit dependency injection; use one nonce domain for each shared signing key. */
export const clientLayer = Near.layerWithServices({
  network: "testnet",
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

export const counterProgram = readCounter.pipe(Effect.provide(clientLayer))

/** Requires a configured signing key; constructs lazy work and never broadcasts. */
export const signTransfer = Effect.gen(function* () {
  const near = yield* Near
  const plan = transactionPlan({
    signerId: "alice.testnet",
    receiverId: "bob.testnet",
    actions: [Actions.transfer(10n ** 24n)], // one NEAR, in yoctoNEAR
  })
  const signed = yield* near.transactions.sign(plan)
  return { hash: signed.hash, bytes: signed.serialize() }
})
