/**
 * Vectors near-primitives 0.39.0-rc.1 (nearcore 2.15.0-rc.1) produced, shared
 * with near-kit-rs: the same calls must give byte-identical encodings, call
 * hashes and unique ids in both libraries, and the views and errors must parse.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64, hex } from "@scure/base"
import { afterEach, describe, expect, test } from "vitest"
import {
  decodeExternalCall,
  type ExternalCall,
  encodeExternalCall,
  externalCallHash,
  externalCallUniqueId,
} from "../../src/core/external-call.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import {
  checkOutcomeForFunctionCallError,
  checkOutcomesForReservedMethodName,
  extractErrorMessage,
  parseRpcError,
} from "../../src/core/rpc/rpc-error-handler.js"
import {
  ExternalCallOutcomeSchema,
  ReceiptViewSchema,
  TransactionEnvelopeSchema,
} from "../../src/core/rpc/rpc-schemas.js"
import {
  ContractNotDeployedError,
  ExternalCallRefusedError,
  FunctionCallError,
  InvalidTransactionError,
  type NearError,
  ReservedMethodNameError,
} from "../../src/errors/index.js"
import {
  universalAccountId,
  universalStateInit,
} from "../helpers/universal-account.js"

type Vector = {
  name: string
  contract_id: string
  payload: string
  state_init: string | null
  bytes: string
  base64: string
  call_hash: string
  tx_root_leaf_hash: string
  unique_ids: { height: string; unique_id: string }[]
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../fixtures/nearcore-2.15/near-primitives-vectors.json",
    ),
    "utf8",
  ),
) as {
  external_calls: Vector[]
  views: Record<string, Record<string, unknown>>
  errors: Record<string, unknown>
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

const callOf = (vector: Vector): ExternalCall =>
  vector.state_init === null
    ? { contractId: vector.contract_id, payload: hex.decode(vector.payload) }
    : {
        contractId: vector.contract_id,
        payload: hex.decode(vector.payload),
        stateInit: hex.decode(vector.state_init),
      }

describe.each(fixture.external_calls)("$name", (vector) => {
  const call = callOf(vector)

  test("encodes byte for byte", () => {
    const bytes = encodeExternalCall(call)
    expect(hex.encode(bytes)).toBe(vector.bytes)
    expect(base64.encode(bytes)).toBe(vector.base64)
    // The chunk's tx_root leaf hashes the call as sent, state init included.
    expect(base58.encode(sha256(bytes))).toBe(vector.tx_root_leaf_hash)
  })

  test("decodes back", () => {
    expect(decodeExternalCall(hex.decode(vector.bytes))).toEqual(call)
  })

  test("has the call hash", () => {
    expect(externalCallHash(call)).toBe(vector.call_hash)
  })

  test("has the unique id at every height", () => {
    for (const { height, unique_id } of vector.unique_ids) {
      expect(externalCallUniqueId(call, BigInt(height))).toBe(unique_id)
      expect(externalCallUniqueId(vector.call_hash, BigInt(height))).toBe(
        unique_id,
      )
    }
  })
})

describe("views", () => {
  test.each([
    "transaction signed",
    "transaction signed without kind",
    "transaction external call",
    "transaction external call with state init",
  ])("%s", (name) => {
    const view = fixture.views[name] as Record<string, unknown>
    const parsed = TransactionEnvelopeSchema.parse(view)
    expect(parsed).toMatchObject(
      "contract_id" in view
        ? { kind: "external_call" }
        : { signer_id: view["signer_id"] },
    )
  })

  test.each([
    "outcome external call accepted",
    "outcome external call refused in the run",
    "outcome external call refused at execution",
  ])("%s", (name) => {
    const parsed = ExternalCallOutcomeSchema.parse({
      final_execution_status: "FINAL",
      ...fixture.views[name],
    })
    expect(parsed.transaction?.kind).toBe("external_call")
  })

  test("a refused outcome throws ExternalCallRefusedError with its unique id", async () => {
    const outcome = {
      final_execution_status: "FINAL",
      ...fixture.views["outcome external call refused at execution"],
      receipts: [],
    }
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: outcome }),
      )) as unknown as typeof global.fetch
    const error = await new RpcClient("https://rpc.test")
      .getExternalCallStatus(
        "9xTNwjY1X96eiEyLs73stYv4WqEZaHNoMKp2j7TZaEki",
        "wallet.near",
        "FINAL",
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    expect((error as ExternalCallRefusedError).uniqueId).toBe(
      "9xTNwjY1X96eiEyLs73stYv4WqEZaHNoMKp2j7TZaEki",
    )
    expect((error as ExternalCallRefusedError).details).toEqual({
      InvalidTxError: { ContractNotFound: { contract_id: "wallet.near" } },
    })
  })

  test.each([
    ["receipt v3 access key", { AccessKey: expect.any(String) }],
    ["receipt v3 external call", "ExternalContractCall"],
  ])("%s", (name, context) => {
    const receipt = ReceiptViewSchema.parse(fixture.views[name])
    expect(receipt.receipt).toMatchObject({
      Action: { authorization_context: context, creation_protocol_version: 89 },
    })
  })
})

describe("errors through the decoders", () => {
  const invalidTx = (name: string) => ({
    name: "HANDLER_ERROR",
    code: -32000,
    message: "Server error",
    data: { TxExecutionError: fixture.errors[name] },
    cause: { name: "INVALID_TRANSACTION", info: {} },
  })
  const thrown = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e as NearError
    }
    throw new Error("did not throw")
  }
  const failedOutcome = (failure: Record<string, unknown>) => ({
    id: "11111111111111111111111111111111",
    outcome: {
      logs: ["before"],
      receipt_ids: [],
      gas_burnt: 1,
      tokens_burnt: "1",
      executor_id: "wallet.near",
      status: { Failure: failure },
    },
    block_hash: "11111111111111111111111111111111",
    proof: [],
  })

  test("ContractNotFound from send_tx is ContractNotDeployedError", () => {
    const error = thrown(() => parseRpcError(invalidTx("ContractNotFound")))
    expect(error).toBeInstanceOf(ContractNotDeployedError)
    expect((error as ContractNotDeployedError).accountId).toBe("wallet.near")
  })

  test.each([
    "ExternalCallChunkShareReached Compute",
    "ExternalCallChunkShareReached StorageProof",
    "RecordingBudgetExceeded",
    "TotalNumberOfGasKeyNoncesAddedExceeded",
  ])("%s from send_tx is InvalidTransactionError with nearcore's error", (name) => {
    const error = thrown(() => parseRpcError(invalidTx(name)))
    expect(error).toBeInstanceOf(InvalidTransactionError)
    expect(JSON.stringify(error.data)).toContain(
      Object.keys(
        (fixture.errors[name] as { InvalidTxError: object }).InvalidTxError,
      )[0],
    )
  })

  test("as a refusal, only a chunk share error is retryable", () => {
    for (const [name, error] of Object.entries(fixture.errors)) {
      const refusal = new ExternalCallRefusedError("wallet.near", error)
      expect(refusal.retryable, name).toBe(
        name.startsWith("ExternalCallChunkShareReached"),
      )
      expect(refusal.message, name).not.toContain("[object Object]")
    }
  })

  test("ReservedMethodName in an outcome is ReservedMethodNameError", () => {
    const error = thrown(() =>
      checkOutcomesForReservedMethodName([
        failedOutcome(
          fixture.errors["ReservedMethodName"] as Record<string, unknown>,
        ),
      ]),
    )
    expect(error).toBeInstanceOf(ReservedMethodNameError)
  })

  test("TotalNumberOfGasKeyNoncesRemovedExceeded reads as a message", () => {
    expect(
      extractErrorMessage(
        fixture.errors["TotalNumberOfGasKeyNoncesRemovedExceeded"] as Record<
          string,
          unknown
        >,
      ),
    ).toBe(
      "TotalNumberOfGasKeyNoncesRemovedExceeded (number_of_nonces: 1025, limit: 1024)",
    )
  })

  test.each([
    ["HostError ProhibitedInExternalCall", "random_seed"],
    ["HostError DepositInExternalCall", "DepositInExternalCall"],
  ])("%s in a run is FunctionCallError", (name, expected) => {
    const failure = {
      ActionError: {
        index: 0,
        kind: { FunctionCallError: { HostError: fixture.errors[name] } },
      },
    }
    const error = thrown(() =>
      checkOutcomeForFunctionCallError(failedOutcome(failure), undefined),
    )
    expect(error).toBeInstanceOf(FunctionCallError)
    expect((error as FunctionCallError).panic).toContain(expected)
    expect((error as FunctionCallError).panic).not.toContain("[object Object]")
    expect((error as FunctionCallError).logs).toEqual(["before"])
  })
})

describe("the universal account test helper", () => {
  test("derives the vector's universal account from its state init", () => {
    const universal = fixture.external_calls.find((v) =>
      v.name.startsWith("universal"),
    ) as Vector
    expect(universalAccountId(hex.decode(universal.state_init as string))).toBe(
      universal.contract_id,
    )
  })

  test("builds a V1 state init with code by hash", () => {
    const bytes = universalStateInit(new Uint8Array(32).fill(7))
    expect(bytes.length).toBe(3 + 32 + 8)
    expect(universalAccountId(bytes)).toMatch(/^0u[0-9a-hjkmnp-tv-z]{52}$/)
  })
})
