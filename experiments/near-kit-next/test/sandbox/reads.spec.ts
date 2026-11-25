import { readFileSync, writeFileSync } from "node:fs"
import * as Near from "@near-kit/next"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"

const url = process.env.NEAR_SANDBOX_URL
if (!url)
  throw new Error(
    "NEAR_SANDBOX_URL is required; this suite never silently skips",
  )
const near = Near.make({ url })
const run = <A, E>(
  effect: Effect.Effect<A, E, import("effect/http/HttpClient").HttpClient>,
) =>
  Effect.runPromise(
    effect.pipe(Effect.timeout("15 seconds"), Effect.provide(Near.fetchLayer)),
  )
const fixture = JSON.parse(
  readFileSync("artifacts/sandbox/fixture.json", "utf8"),
) as {
  codeHash: string
  amount: string
  locked: string
  storageUsage: number
  wasmSha256: string
}
it("reads real node status: { ...status, latestBlockHeight: status.latestBlockHeight.toString() }, exact account quantities and a consistent selected block", async () => {
  const status = await run(Near.status(near))
  expect(status.chainId).toBe("near-kit-read-fixture")
  const block = await run(Near.block(near))
  const account = await run(
    Near.account(near, "sandbox", { at: { hash: block.blockHash } }),
  )
  expect(account).toMatchObject({
    amount: BigInt(fixture.amount),
    locked: BigInt(fixture.locked),
    codeHash: fixture.codeHash,
    blockHash: block.blockHash,
    blockHeight: block.blockHeight,
  })
  // nearcore recomputes genesis storage from records. The submitted field is
  // not an oracle; compare the adapter's projection with the exact raw query.
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "storage-reference",
      method: "query",
      params: {
        request_type: "view_account",
        account_id: "sandbox",
        block_id: block.blockHash,
      },
    }),
    signal: AbortSignal.timeout(3000),
  })
  const raw = (await response.json()) as {
    result: {
      storage_usage: number
    }
  }
  expect(response.ok).toBe(true)
  expect(account.storageUsage).toBe(BigInt(raw.result.storage_usage))
  expect(account.storageUsage).toBeGreaterThan(BigInt(fixture.storageUsage))
  expect(block.timestampNanoseconds).toBeGreaterThan(
    BigInt(Number.MAX_SAFE_INTEGER),
  )
  writeFileSync(
    "artifacts/sandbox/read-evidence.json",
    JSON.stringify(
      {
        status: {
          ...status,
          latestBlockHeight: status.latestBlockHeight.toString(),
        },
        block: {
          ...block,
          timestampNanoseconds: block.timestampNanoseconds.toString(),
          blockHeight: block.blockHeight.toString(),
          gasPrice: block.gasPrice.toString(),
        },
        account: {
          ...account,
          amount: account.amount.toString(),
          locked: account.locked.toString(),
          blockHeight: account.blockHeight.toString(),
          storageUsage: account.storageUsage.toString(),
        },
        fixture,
      },
      null,
      2,
    ),
  )
})
it("maps a real structured absent-account response", async () => {
  expect(
    await run(Near.account(near, "missing.sandbox").pipe(Effect.flip)),
  ).toMatchObject({ _tag: "AccountNotFound", accountId: "missing.sandbox" })
})
it("executes a genesis-seeded JSON view and retains its logs", async () => {
  const result = await run(
    Near.view(near, {
      accountId: "sandbox",
      method: "json",
      schema: Schema.Struct({ count: Schema.Number }),
    }),
  )
  expect(result.value).toEqual({ count: 7 })
  expect(result.logs).toContain("fixture log")
})
it("supports binary output and both independent argument encodings on the real node", async () => {
  expect(
    Array.from(
      (
        await run(
          Near.viewBytes(near, {
            accountId: "sandbox",
            method: "binary",
            args: { json: true },
          }),
        )
      ).value,
    ),
  ).toEqual([0, 255, 1])
  const bytes = new Uint8Array([0, 255, 1])
  expect(
    Array.from(
      (
        await run(
          Near.viewBytes(near, {
            accountId: "sandbox",
            method: "echo",
            args: bytes,
          }),
        )
      ).value,
    ),
  ).toEqual([0, 255, 1])
  expect(
    (
      await run(
        Near.view(near, {
          accountId: "sandbox",
          method: "echo",
          args: { message: "hello" },
          schema: Schema.Struct({ message: Schema.String }),
        }),
      )
    ).value,
  ).toEqual({ message: "hello" })
})
it("distinguishes empty bytes from absent JSON output", async () => {
  expect(
    (await run(Near.viewBytes(near, { accountId: "sandbox", method: "empty" })))
      .value.byteLength,
  ).toBe(0)
  expect(
    await run(
      Near.view(near, {
        accountId: "sandbox",
        method: "empty",
        schema: Schema.Unknown,
      }).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "DecodeError" })
})
it.each([
  "invalid_json",
  "invalid_utf8",
])("rejects real contract output %s", async (method) => {
  expect(
    await run(
      Near.view(near, {
        accountId: "sandbox",
        method,
        schema: Schema.Unknown,
      }).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "DecodeError" })
})
it("maps actual contract execution failure without exposing panic text", async () => {
  const failure = await run(
    Near.viewBytes(near, { accountId: "sandbox", method: "panic" }).pipe(
      Effect.flip,
    ),
  )
  expect(failure).toMatchObject({ _tag: "RpcError", kind: "ContractExecution" })
  expect(JSON.stringify(failure)).not.toContain("fixture panic")
})
it("does not fall back from an unavailable requested block", async () => {
  expect(
    await run(
      Near.account(near, "sandbox", { at: { height: 999999999n } }).pipe(
        Effect.flip,
      ),
    ),
  ).toMatchObject({ _tag: "RpcError" })
})
