import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { afterEach, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import { ExternalError, type NearFailure } from "../../src/effect/runtime.js"

const account = {
  amount: "1000",
  locked: "0",
  code_hash: "11111111111111111111111111111111",
  storage_usage: 0,
  storage_paid_at: 0,
  block_height: 1,
  block_hash: "block",
}
const code = {
  code_base64: "#",
  hash: "hash",
  block_height: 1,
  block_hash: "block",
}
const cases: Array<{
  name: string
  result: unknown
  native: (near: Near) => Effect.Effect<unknown, NearFailure>
  promise: (near: Near) => Promise<unknown>
  error: ErrorConstructor
}> = [
  {
    name: "balance invalid amount",
    result: { ...account, amount: "not-decimal" },
    native: (near: Near) => near.effects.getBalance("alice.near"),
    promise: (near: Near) => near.getBalance("alice.near"),
    error: SyntaxError,
  },
  {
    name: "account fractional storage",
    result: { ...account, storage_usage: 1.5 },
    native: (near: Near) => near.effects.getAccount("alice.near"),
    promise: (near: Near) => near.getAccount("alice.near"),
    error: RangeError,
  },
  {
    name: "contract invalid base64",
    result: code,
    native: (near: Near) => near.effects.getContractCode("alice.near"),
    promise: (near: Near) => near.getContractCode("alice.near"),
    error: Error,
  },
  {
    name: "global contract invalid base64",
    result: code,
    native: (near: Near) =>
      near.effects.getGlobalContract({ accountId: "alice.near" }),
    promise: (near: Near) =>
      near.getGlobalContract({ accountId: "alice.near" }),
    error: Error,
  },
]
afterEach(() => vi.restoreAllMocks())

test.each(cases)(
  "untrusted RPC $name remains a typed recoverable failure",
  async ({ result, native, promise, error }) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result }),
    )
    const near = new Near({
      rpcUrl: "https://unused.invalid",
      retryConfig: { maxRetries: 0 },
    })
    const exit = await Effect.runPromiseExit(native(near))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true)
      expect(Cause.hasDies(exit.cause)).toBe(false)
      const failure = Cause.squash(exit.cause)
      expect(failure).toBeInstanceOf(ExternalError)
      if (failure instanceof ExternalError)
        expect(failure.cause).toBeInstanceOf(error)
    }
    await expect(promise(near)).rejects.toBeInstanceOf(error)
  },
)
