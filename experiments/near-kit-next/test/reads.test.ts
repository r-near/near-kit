import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import * as Near from "../src/index.js"
import {
  accountWire,
  HASH,
  harness,
  OTHER_HASH,
  unknownAccount,
  viewWire,
} from "./fixtures.js"

const URL = "https://example.test/rpc"
it.effect("preserves exact account quantities and response provenance", () =>
  Effect.gen(function* () {
    const h = harness(() => ({
      ...accountWire,
      global_contract_hash: HASH,
      global_contract_account_id: null,
    }))
    const account = yield* h.provide(
      Near.account(Near.make({ url: URL }), "alice.testnet"),
    )
    expect(account).toMatchObject({
      amount: 1234567890123456789012345n,
      locked: 0n,
      storageUsage: 410n,
      codeHash: accountWire.code_hash,
      blockHash: HASH,
      blockHeight: 123n,
      globalContractHash: HASH,
    })
    expect(account.globalContractAccountId).toBeUndefined()
    expect(h.requests[0]?.request).toMatchObject({
      jsonrpc: "2.0",
      method: "query",
      params: {
        request_type: "view_account",
        account_id: "alice.testnet",
        finality: "final",
      },
    })
  }),
)
it.effect(
  "is lazy, snapshots configuration and resolves transport on each execution",
  () =>
    Effect.gen(function* () {
      const headers = { "x-test": "original" }
      const config = { url: URL, headers }
      const client = Near.make(config)
      const saved = Near.account(client, "alice.testnet")
      const a = harness()
      const b = harness(() => ({ ...accountWire, amount: "7" }))
      expect(a.requests).toHaveLength(0)
      config.url = "https://changed.test/"
      headers["x-test"] = "changed"
      yield* a.provide(saved)
      const second = yield* b.provide(saved)
      expect(a.requests).toHaveLength(1)
      expect(b.requests).toHaveLength(1)
      expect(second.amount).toBe(7n)
      expect(b.requests[0]?.url).toBe(URL)
      expect(new Headers(b.requests[0]?.init.headers).get("x-test")).toBe(
        "original",
      )
    }),
)
it.effect(
  "uses explicit height zero and rejects mismatched response references",
  () =>
    Effect.gen(function* () {
      const zero = harness(() => ({ ...accountWire, block_height: 0 }))
      const client = Near.make({ url: URL })
      const result = yield* zero.provide(
        Near.account(client, "alice.testnet", { at: { height: 0n } }),
      )
      expect(result.blockHeight).toBe(0n)
      expect(zero.requests[0]?.request.params).toMatchObject({ block_id: 0 })
      expect(zero.requests[0]?.request.params).not.toHaveProperty("finality")
      const wrong = harness()
      const error = yield* wrong
        .provide(
          Near.account(client, "alice.testnet", { at: { hash: OTHER_HASH } }),
        )
        .pipe(Effect.flip)
      expect(error._tag).toBe("DecodeError")
    }),
)
it.effect("projects exact block timestamp from the decimal field", () =>
  Effect.gen(function* () {
    const h = harness(() => ({
      header: {
        hash: HASH,
        prev_hash: OTHER_HASH,
        gas_price: "100000000",
        height: 123,
        timestamp: 1790800000000000000,
        timestamp_nanosec: "1790800000000000123",
      },
    }))
    const block = yield* h.provide(Near.block(Near.make({ url: URL })))
    expect(block).toMatchObject({
      blockHash: HASH,
      blockHeight: 123n,
      timestampNanoseconds: 1790800000000000123n,
    })
    expect(h.requests[0]?.request).toMatchObject({
      method: "block",
      params: { finality: "final" },
    })
  }),
)
it.effect("projects node status without claiming finalized state", () =>
  Effect.gen(function* () {
    const h = harness(() => ({
      chain_id: "testnet",
      protocol_version: 87,
      sync_info: {
        latest_block_hash: HASH,
        latest_block_height: 123,
        syncing: false,
        latest_block_time: "ignored",
      },
    }))
    expect(
      yield* h.provide(Near.status(Near.make({ url: URL }))),
    ).toMatchObject({
      chainId: "testnet",
      protocolVersion: 87,
      latestBlockHash: HASH,
      latestBlockHeight: 123n,
    })
    expect(h.requests[0]?.request.method).toBe("status")
  }),
)
it.effect(
  "validates inferred contract JSON while preserving logs and block metadata",
  () =>
    Effect.gen(function* () {
      const h = harness(() => viewWire())
      const result = yield* h.provide(
        Near.view(Near.make({ url: URL }), {
          accountId: "contract.testnet",
          method: "count",
          args: { by: 2 },
          schema: Schema.Struct({ count: Schema.Number }),
        }),
      )
      const count: number = result.value.count
      expect(count).toBe(7)
      expect(result).toMatchObject({
        logs: ["fixture log"],
        blockHash: HASH,
        blockHeight: 123n,
      })
      expect(h.requests[0]?.request.params).toMatchObject({
        request_type: "call_function",
        finality: "final",
      })
      expect(
        Buffer.from(
          String(h.requests[0]?.request.params.args_base64),
          "base64",
        ).toString(),
      ).toBe('{"by":2}')
    }),
)
it.effect(
  "supports mixed input/output encodings and takes request bytes at execution",
  () =>
    Effect.gen(function* () {
      const input = new Uint8Array([1, 2])
      const client = Near.make({ url: URL })
      const json = Near.view(client, {
        accountId: "contract.testnet",
        method: "json",
        args: input,
        schema: Schema.Unknown,
      })
      input[0] = 9
      const h = harness(() => viewWire())
      yield* h.provide(json)
      expect(
        Array.from(
          Buffer.from(
            String(h.requests[0]?.request.params.args_base64),
            "base64",
          ),
        ),
      ).toEqual([9, 2])
      const binary = harness(() => viewWire(new Uint8Array([0, 255, 1])))
      const result = yield* binary.provide(
        Near.viewBytes(client, {
          accountId: "contract.testnet",
          method: "binary",
          args: { lookup: true },
        }),
      )
      expect(Array.from(result.value)).toEqual([0, 255, 1])
      expect(
        Buffer.from(
          String(binary.requests[0]?.request.params.args_base64),
          "base64",
        ).toString(),
      ).toBe('{"lookup":true}')
    }),
)
it.effect(
  "distinguishes empty bytes, JSON null, malformed JSON and schema mismatch",
  () =>
    Effect.gen(function* () {
      const client = Near.make({ url: URL })
      const options = { accountId: "contract.testnet", method: "read" }
      const empty = harness(() => viewWire(new Uint8Array()))
      expect(
        (yield* empty.provide(Near.viewBytes(client, options))).value
          .byteLength,
      ).toBe(0)
      expect(
        (yield* empty
          .provide(Near.view(client, { ...options, schema: Schema.Unknown }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const jsonNull = harness(() => viewWire(new TextEncoder().encode("null")))
      expect(
        (yield* jsonNull.provide(
          Near.view(client, { ...options, schema: Schema.Null }),
        )).value,
      ).toBeNull()
      const text = harness(() => viewWire(new TextEncoder().encode("not JSON")))
      expect(
        (yield* text
          .provide(Near.view(client, { ...options, schema: Schema.String }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const mismatch = harness(() => viewWire())
      expect(
        (yield* mismatch
          .provide(Near.view(client, { ...options, schema: Schema.String }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
)
it.effect(
  "treats only structured matching account absence as AccountNotFound",
  () =>
    Effect.gen(function* () {
      const client = Near.make({ url: URL })
      const known = harness((request) => unknownAccount(request.id), false)
      expect(
        (yield* known
          .provide(Near.account(client, "missing.testnet"))
          .pipe(Effect.flip))._tag,
      ).toBe("AccountNotFound")
      const mismatch = harness(
        (request) => unknownAccount(request.id, "another.testnet"),
        false,
      )
      expect(
        (yield* mismatch
          .provide(Near.account(client, "missing.testnet"))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const legacy = harness(
        (request) => ({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: "missing",
            data: "account missing.testnet does not exist",
          },
        }),
        false,
      )
      expect(
        (yield* legacy
          .provide(Near.account(client, "missing.testnet"))
          .pipe(Effect.flip))._tag,
      ).toBe("RpcError")
    }),
)
for (const [name, changes] of [
  ["fractional storage", { storage_usage: 0.5 }],
  ["out-of-range height", { block_height: 2 ** 64 }],
  ["noncanonical amount", { amount: "01" }],
  ["negative amount", { amount: "-1" }],
  ["u128 overflow", { amount: (1n << 128n).toString() }],
] as const) {
  it.effect(`rejects ${name}`, () =>
    Effect.gen(function* () {
      const h = harness(() => ({ ...accountWire, ...changes }))
      const error = yield* h
        .provide(Near.account(Near.make({ url: URL }), "alice.testnet"))
        .pipe(Effect.flip)
      expect(error._tag).toBe("DecodeError")
    }),
  )
}
for (const value of [-1, 256, 1.5, null, "1"]) {
  it.effect(`rejects non-byte contract result element ${String(value)}`, () =>
    Effect.gen(function* () {
      const h = harness(() => ({ ...viewWire(), result: [value] }))
      expect(
        (yield* h
          .provide(
            Near.viewBytes(Near.make({ url: URL }), {
              accountId: "contract.testnet",
              method: "read",
            }),
          )
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
  )
}
it.effect(
  "maps result-level view execution failure without inventing an RPC code",
  () =>
    Effect.gen(function* () {
      const h = harness(() => ({
        error: "untrusted-contract-SECRET",
        logs: [],
        block_hash: HASH,
        block_height: 123,
      }))
      const error = yield* h
        .provide(
          Near.viewBytes(Near.make({ url: URL }), {
            accountId: "contract.testnet",
            method: "read",
          }),
        )
        .pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "RpcError",
        kind: "ContractExecution",
      })
      if (error._tag === "RpcError") expect(error.code).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain("untrusted-contract-SECRET")
    }),
)
it.effect("rejects ambiguous result-level view success and failure", () =>
  Effect.gen(function* () {
    const h = harness(() => ({ ...viewWire(), error: "unexpected" }))
    expect(
      (yield* h
        .provide(
          Near.viewBytes(Near.make({ url: URL }), {
            accountId: "contract.testnet",
            method: "read",
          }),
        )
        .pipe(Effect.flip))._tag,
    ).toBe("DecodeError")
  }),
)
