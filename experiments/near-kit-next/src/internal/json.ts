import * as Effect from "effect/Effect"
import { DecodeError, type Operation, UnsupportedError } from "../errors.js"

interface SourceContext {
  readonly source?: string
}
interface NativeJson {
  parse(
    text: string,
    reviver?: (key: string, value: unknown, context?: SourceContext) => unknown,
  ): unknown
  rawJSON?: (text: string) => unknown
  isRawJSON?: (value: unknown) => boolean
}
const native = JSON as NativeJson
const invalidNumber = Symbol("Invalid wire number")
const maxInteger = "18446744073709551615"

export function requireNativeJson(
  operation: Operation,
): Effect.Effect<void, UnsupportedError> {
  return Effect.suspend(() => {
    try {
      let source: string | undefined
      native.parse("9007199254740993", (_key, value, context) => {
        source = context?.source
        return value
      })
      const raw = native.rawJSON?.("9007199254740993")
      if (
        source === "9007199254740993" &&
        native.isRawJSON?.(raw) === true &&
        JSON.stringify(raw) === source
      )
        return Effect.void
    } catch {
      /* A missing/incomplete platform capability is not an RPC failure. */
    }
    return Effect.fail(
      new UnsupportedError({ operation, feature: "LosslessJson" }),
    )
  })
}
export function rawHeight(height: bigint): unknown {
  // Only called after the operation's semantic capability check and u64 validation.
  return native.rawJSON?.(height.toString())
}
export function isRawJson(value: unknown): boolean {
  return native.isRawJSON?.(value) === true
}
export function isJsonResourceError(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (error instanceof Error &&
      error.name === "InternalError" &&
      error.message === "too much recursion")
  )
}
function reviveNumber(
  _key: string,
  value: unknown,
  context?: SourceContext,
): unknown {
  if (typeof value !== "number") return value
  const text = context?.source
  if (
    text === undefined ||
    text.length > 21 ||
    !/^(0|-?[1-9][0-9]*)$/.test(text)
  )
    return invalidNumber
  const digits = text.startsWith("-") ? text.slice(1) : text
  if (digits.length > 20 || (digits.length === 20 && digits > maxInteger))
    return invalidNumber
  return Number.isSafeInteger(value) ? value : BigInt(text)
}
export function parseJson(
  bytes: Uint8Array,
  operation: Operation,
  wire = false,
) {
  return Effect.gen(function* () {
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: (error) => {
        if (error instanceof TypeError)
          return new DecodeError({ operation, reason: "InvalidUtf8" })
        throw error
      },
    })
    return yield* Effect.try({
      try: () => native.parse(text, wire ? reviveNumber : undefined),
      catch: (error) => {
        if (error instanceof SyntaxError)
          return new DecodeError({ operation, reason: "InvalidJson" })
        if (isJsonResourceError(error))
          return new DecodeError({ operation, reason: "JsonResource" })
        throw error
      },
    })
  })
}
