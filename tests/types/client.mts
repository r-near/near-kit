/** Compile-only application ownership and custody requirements. */
import { Effect, Layer } from "effect"
import { Near as PromiseNear } from "near-kit"
import {
  Client,
  Near,
  Rpc,
  KeyStore,
  NonceReservation,
  Signer,
  Wallet,
} from "near-kit/effect"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Assert<T extends true> = T

export const client = Client.layer(
  {},
  Effect.all({ signer: Signer, wallet: Wallet }),
)
export type RequiredCapabilities = Assert<
  Equal<
    Layer.Services<typeof client>,
    Rpc | KeyStore | NonceReservation | Signer | Wallet
  >
>
export type ProvidedClient = Assert<
  Equal<Layer.Success<typeof client>, Client | Near>
>

export const application = Effect.gen(function* () {
  const acquired = yield* Client
  const facade: PromiseNear = PromiseNear.fromClient(acquired)
  const result: Promise<string> = facade.getBalance("alice.near")
  return yield* Effect.promise(() => result)
})

export function invalidUnprovidedRun() {
  // @ts-expect-error The application must provide its scoped client layer.
  return Effect.runPromise(application)
}
