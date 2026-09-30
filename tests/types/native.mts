// Compile-only consumer contract. Never execute this fixture.
import { Effect, Layer } from "effect"
import type { Contract, DelegateActionResult } from "near-kit"
import {
  Near,
  Rpc,
  KeyStore,
  NonceReservation,
  Wallet,
  batch,
  type NearFailure,
  type NearService,
} from "near-kit/effect"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Must<T extends true> = T
export type RequiredClientInputs = Must<
  Equal<
    Layer.Services<ReturnType<typeof Near.layerWithServices>>,
    Rpc | KeyStore | NonceReservation
  >
>
export type RequiredWalletInputs = Must<
  Equal<
    Layer.Services<ReturnType<typeof Near.layerWithWallet>>,
    Rpc | KeyStore | NonceReservation | Wallet
  >
>
export type NativeClientOutput = Must<
  Equal<Layer.Success<ReturnType<typeof Near.layerWithServices>>, Near>
>

export const read = Effect.gen(function* () {
  const near = yield* Near
  return yield* near.getBalance("alice.near")
})
export type ReadResult = Must<Equal<Effect.Success<typeof read>, string>>
export type ReadRequirements = Must<Equal<Effect.Services<typeof read>, Near>>
export type ReadError = Must<Equal<Effect.Error<typeof read>, NearFailure>>

export function consumeNative(near: NearService) {
  const tx = near.transaction("alice.near").transfer("bob.near", "1 NEAR")
  const bytes: Effect.Effect<
    DelegateActionResult<"bytes">,
    NearFailure
  > = tx.delegate({ payloadFormat: "bytes" })
  const base64: Effect.Effect<
    DelegateActionResult<"base64">,
    NearFailure
  > = tx.delegate()
  const none = tx.send({ waitUntil: "NONE" })
  const final = tx.send({ waitUntil: "FINAL" })
  const noneIsNarrow: Must<
    Equal<Effect.Success<typeof none>["final_execution_status"], "NONE">
  > = true
  const finalIsNarrow: Must<
    Equal<Effect.Success<typeof final>["final_execution_status"], "FINAL">
  > = true
  const account: Effect.Effect<string | undefined, NearFailure> =
    near.view<string>("contract.near", "read")
  const contract = near.contract<
    Contract<{
      view: { read: () => Promise<number> }
      call: { write: (args: { by: number }) => Promise<void> }
    }>
  >("contract.near")
  const value: Effect.Effect<number, NearFailure> = contract.view.read()
  const written: Effect.Effect<void, NearFailure> = contract.call.write(
    { by: 1 },
    { gas: "30 Tgas" },
  )
  const combined = batch(Effect.succeed(1), Effect.succeed("value"))
  const tupleIsPreserved: Must<
    Equal<Effect.Success<typeof combined>, [number, string]>
  > = true
  // Required dependencies cannot be discarded at the runner boundary.
  // @ts-expect-error The client service must be supplied before running.
  const missingService = Effect.runPromise(read)
  // @ts-expect-error Wait levels must remain protocol literals.
  const invalidWait = tx.send({ waitUntil: "ALMOST_FINAL" })
  return {
    bytes,
    base64,
    none,
    final,
    noneIsNarrow,
    finalIsNarrow,
    account,
    value,
    written,
    tupleIsPreserved,
    missingService,
    invalidWait,
  }
}
