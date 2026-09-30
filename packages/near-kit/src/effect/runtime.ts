/** Effect programs and the backwards-compatible Promise boundary. */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ZodError } from "zod"
import { NearError } from "../errors/index.js"

/** A failure reported by a Promise-only extension such as a wallet or signer. */
export class ExternalError extends Schema.TaggedError<ExternalError>()(
  "ExternalError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

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

/** Public operational failures of composed SDK programs. */
export type NearFailure = NearError | ZodError | ExternalError

/** Expected input/encoding failures, preserving SDK error classes where known. */
export const inputEffect = <A>(
  operation: () => A,
  name: string,
): Effect.Effect<A, NearFailure> =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof NearError || cause instanceof ZodError
        ? cause
        : new ExternalError({ operation: name, cause }),
  })

/** A synchronous third-party extension boundary, with a typed original cause. */
export const fromSync = <A>(
  operation: () => A,
  name: string,
): Effect.Effect<A, ExternalError> =>
  Effect.try({
    try: operation,
    catch: (cause) => new ExternalError({ operation: name, cause }),
  })

/** Synchronous compatibility edge for constructors and pure state operations. */
export const runSync = <A, E>(program: Effect.Effect<A, E>): A => {
  try {
    return Effect.runSync(program)
  } catch (failure) {
    if (failure instanceof ExternalError) throw failure.cause
    throw failure
  }
}
