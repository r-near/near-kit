/** Effect programs and the backwards-compatible Promise boundary. */
import { Data, Effect } from "effect"

/** A failure reported by a Promise-only extension such as a wallet or signer. */
export class ExternalError extends Data.TaggedError("ExternalError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/**
 * Execute an SDK program at its Promise boundary. Effect 4 preserves its own
 * failures; extension failures are unwrapped to retain the exact rejection value
 * and `instanceof` behavior that the original Promise-only SDK exposed.
 */
export const runPromise = <A, E>(
  effect: Effect.Effect<A, E>,
  options?: Effect.RunOptions,
): Promise<A> =>
  Effect.runPromise(effect, options).catch((error: unknown) => {
    if (error instanceof ExternalError) throw error.cause
    throw error
  })

/**
 * Adapt an external Promise-only extension. Built-in services must compose their
 * native programs directly instead. The signal lets cooperative extensions stop
 * work when their owning fiber is interrupted; a legacy Promise may ignore it.
 */
export const fromPromise = <A>(
  operation: (signal: AbortSignal) => PromiseLike<A>,
  name = "external",
): Effect.Effect<A, ExternalError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new ExternalError({ operation: name, cause }),
  })
