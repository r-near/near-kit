/** Compile-only separation of resource-free preparation and scoped activation. */
import { Effect, type Scope } from "effect"
import { Near } from "near-kit"
import { prepareClient, type PreparedClient } from "near-kit/effect"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Assert<T extends true> = T

export type PreparationRequirements = Assert<
  Equal<Effect.Services<ReturnType<typeof prepareClient>>, never>
>
export type ActivationRequiresScope = Assert<
  Equal<Effect.Services<PreparedClient["activate"]>, Scope.Scope>
>

export function projectPrepared(prepared: PreparedClient): Near {
  return Near.fromClient(prepared.client)
}

export function unscopedActivation(prepared: PreparedClient) {
  // @ts-expect-error An owner must provide the activation scope.
  return Effect.runPromise(prepared.activate)
}
