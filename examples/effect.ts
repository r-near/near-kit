/** Native Effect entrypoint. Programs are lazy; importing this file does no I/O. */
import { Effect, Layer } from "effect"
import { InMemoryKeyStore, type Contract } from "near-kit"
import { KeyStore, Near, NonceReservation, Rpc } from "near-kit/effect"

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
