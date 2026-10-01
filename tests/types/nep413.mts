// Compile-only native reader contract. Never execute this fixture.
import { Context, Effect } from "effect"
import type { AccessKeyView, SignedMessage, SignMessageParams } from "near-kit"
import { verifyNep413Signature } from "near-kit/effect"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Must<T extends true> = T
class KeyPolicy extends Context.Service<
  KeyPolicy,
  { key: AccessKeyView | null }
>()("test/KeyPolicy") {}

export function consumeNativeVerification(
  signed: SignedMessage,
  params: SignMessageParams,
) {
  const program = verifyNep413Signature(signed, params, {
    near: { getAccessKey: () => Effect.map(KeyPolicy, (policy) => policy.key) },
  })
  const requirements: Must<Equal<Effect.Services<typeof program>, KeyPolicy>> =
    true
  const failures: Must<Equal<Effect.Error<typeof program>, never>> = true
  // @ts-expect-error A custom reader's service requirement cannot be discarded.
  const missing = Effect.runPromise(program)
  const provided: Promise<boolean> = Effect.runPromise(
    Effect.provideService(program, KeyPolicy, { key: null }),
  )
  return { requirements, failures, missing, provided }
}
