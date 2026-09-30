// Compile-only consumer contract. Never execute this fixture.
/* oxlint-disable effecttsgo/unstable-api-usage -- The opt-in consumer explicitly selects the pinned Effect HTTP stack. */
import { Effect, Layer } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/http"
import { Rpc, rpcTransportHttpClient } from "near-kit/effect"

const applicationRpc = Rpc.layer({ url: "https://rpc.test" }).pipe(
  Layer.provide(rpcTransportHttpClient),
)
// Applications must select and supply their own HttpClient.
export const needsHttp: Layer.Layer<Rpc, never, HttpClient.HttpClient> =
  applicationRpc

export const readGasPrice = Effect.gen(function* () {
  const rpc = yield* Rpc
  return yield* rpc.getGasPrice()
}).pipe(Effect.provide(applicationRpc))
// @ts-expect-error Selecting the adapter does not supply an HTTP implementation.
void Effect.runPromise(readGasPrice)

export const fullyProvided = readGasPrice.pipe(
  Effect.provide(FetchHttpClient.layer),
)
export const result: Promise<{ readonly gas_price: string }> =
  Effect.runPromise(fullyProvided)
/* oxlint-enable effecttsgo/unstable-api-usage */
