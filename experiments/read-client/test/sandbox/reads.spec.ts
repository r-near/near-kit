import { readFileSync, writeFileSync } from "node:fs"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import { Near } from "@near-kit/read-experiment"

const url = process.env.NEAR_SANDBOX_URL
if (!url) throw new Error("NEAR_SANDBOX_URL is required; this suite never silently skips")
const near = Near.make({ url })
const run = <A, E>(effect: Effect.Effect<A, E, import("effect/http/HttpClient").HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.timeout("15 seconds"), Effect.provide(Near.fetchLayer)))
const fixture = JSON.parse(readFileSync("artifacts/sandbox/fixture.json", "utf8")) as {
  codeHash: string; amount: string; locked: string; storageUsage: number; wasmSha256: string
}

it("reads real node status, exact account quantities and a consistent selected block", async () => {
  const status = await run(near.status())
  expect(status.chainId).toBe("near-kit-read-fixture")
  const block = await run(near.block())
  const account = await run(near.account("sandbox", { at: { hash: block.blockHash } }))
  expect(account).toMatchObject({
    amount: BigInt(fixture.amount), locked: BigInt(fixture.locked), storageUsage: fixture.storageUsage,
    codeHash: fixture.codeHash, blockHash: block.blockHash, blockHeight: block.blockHeight,
  })
  expect(block.timestampNanoseconds).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
  writeFileSync("artifacts/sandbox/read-evidence.json", JSON.stringify({
    status, block: { ...block, timestampNanoseconds: block.timestampNanoseconds.toString() },
    account: { ...account, amount: account.amount.toString(), locked: account.locked.toString() },
    fixture,
  }, null, 2))
})

it("maps a real structured absent-account response", async () => {
  expect(await run(near.account("missing.sandbox").pipe(Effect.flip))).toMatchObject({ _tag: "AccountNotFound", accountId: "missing.sandbox" })
})

it("executes a genesis-seeded JSON view and retains its logs", async () => {
  const result = await run(near.view({ accountId: "sandbox", method: "json", schema: Schema.Struct({ count: Schema.Number }) }))
  expect(result.value).toEqual({ count: 7 })
  expect(result.logs).toContain("fixture log")
})

it("supports binary output and both independent argument encodings on the real node", async () => {
  expect(Array.from((await run(near.viewBytes({ accountId: "sandbox", method: "binary", args: { json: true } }))).value)).toEqual([0, 255, 1])
  const bytes = new Uint8Array([0, 255, 1])
  expect(Array.from((await run(near.viewBytes({ accountId: "sandbox", method: "echo", args: bytes }))).value)).toEqual([0, 255, 1])
  expect((await run(near.view({ accountId: "sandbox", method: "echo", args: { message: "hello" }, schema: Schema.Struct({ message: Schema.String }) }))).value).toEqual({ message: "hello" })
})

it("distinguishes empty bytes from absent JSON output", async () => {
  expect((await run(near.viewBytes({ accountId: "sandbox", method: "empty" }))).value.byteLength).toBe(0)
  expect(await run(near.view({ accountId: "sandbox", method: "empty", schema: Schema.Unknown }).pipe(Effect.flip))).toMatchObject({ _tag: "DecodeError" })
})

it.each(["invalid_json", "invalid_utf8"])("rejects real contract output %s", async (method) => {
  expect(await run(near.view({ accountId: "sandbox", method, schema: Schema.Unknown }).pipe(Effect.flip))).toMatchObject({ _tag: "DecodeError" })
})

it("maps actual contract execution failure without exposing panic text", async () => {
  const failure = await run(near.viewBytes({ accountId: "sandbox", method: "panic" }).pipe(Effect.flip))
  expect(failure).toMatchObject({ _tag: "RpcError", kind: "ContractExecution" })
  expect(JSON.stringify(failure)).not.toContain("fixture panic")
})

it("does not fall back from an unavailable requested block", async () => {
  expect(await run(near.account("sandbox", { at: { height: 999_999_999 } }).pipe(Effect.flip))).toMatchObject({ _tag: "RpcError" })
})
