import { TransactionV1Schema } from "../../src/core/schema.js"
/**
 * Unit tests for TransactionBuilder.nonce() — signing at a caller-chosen nonce.
 */

import { describe, expect, test } from "vitest"
import { rpcToPromises, type RpcClient } from "../../src/core/rpc/rpc.js"
import { testRpcPrograms } from "../helpers/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import type { AccessKeyView, WalletConnection } from "../../src/core/types.js"
import { InvalidNonceError, NearError } from "../../src/errors/index.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"

const BLOCK_HASH = "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL"

interface MockRpcCounters {
  accessKeyCalls: number
  gasKeyNonceCalls: number
  sendCalls: number
}

function mockRpc(
  counters: MockRpcCounters,
  options: {
    chainNonce?: number
    slotNonces?: unknown[]
  } = {},
): RpcClient {
  return {
    async getAccessKey(): Promise<AccessKeyView> {
      counters.accessKeyCalls++
      return {
        nonce: options.chainNonce ?? 10,
        permission: "FullAccess",
        block_height: 12345,
        block_hash: BLOCK_HASH,
      }
    },
    async call(method: string) {
      if (method === "EXPERIMENTAL_view_gas_key_nonces") {
        counters.gasKeyNonceCalls++
        return { nonces: options.slotNonces ?? [100, 200, 300, 400] }
      }
      throw new Error(`unexpected rpc call ${method}`)
    },
    async getBlock() {
      return { header: { hash: BLOCK_HASH, height: 12345 } }
    },
    async sendTransaction() {
      counters.sendCalls++
      return {
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status: { SuccessValue: "" },
        transaction: {},
        transaction_outcome: { id: "tx", outcome: { status: {} } },
      }
    },
  } as unknown as RpcClient
}

async function setup(
  options: {
    chainNonce?: number
    slotNonces?: unknown[]
  } = {},
) {
  // A unique account per test keeps the shared nonce reservation state
  // from leaking between tests.
  const accountId = `explicit-nonce-${Math.random().toString(36).slice(2)}.near`
  const keyStore = new InMemoryKeyStore()
  await keyStore.add(accountId, generateKey())
  const counters: MockRpcCounters = {
    accessKeyCalls: 0,
    gasKeyNonceCalls: 0,
    sendCalls: 0,
  }
  const rpc = mockRpc(counters, options)
  const builder = () => new TransactionBuilder(accountId, rpc, keyStore)
  return { builder, counters, rpc, keyStore, accountId }
}

describe("TransactionBuilder.nonce()", () => {
  test("signs an ordinary transaction at the given nonce without fetching the access key", async () => {
    const { builder, counters } = await setup()

    const tx = await builder().nonce(42n).transfer("bob.near", "1 NEAR").build()

    expect(tx.nonce).toBe(42n)
    expect(counters.accessKeyCalls).toBe(0)
  })

  test("accepts a safe-integer number", async () => {
    const { builder } = await setup()
    const tx = await builder().nonce(7).transfer("bob.near", "1 NEAR").build()
    expect(tx.nonce).toBe(7n)
  })

  test("does not read or advance the shared nonce cache", async () => {
    const { builder, counters } = await setup({ chainNonce: 10 })

    await builder().nonce(5_000n).transfer("bob.near", "1 NEAR").sign()

    // A later cache-managed transaction still starts from the chain nonce,
    // not from the explicit nonce.
    const next = await builder().transfer("bob.near", "1 NEAR").build()
    expect(next.nonce).toBe(11n)
    expect(counters.accessKeyCalls).toBe(1)
  })

  test("sets the nonce of a gas-key slot after confirming the slot exists", async () => {
    const { builder, counters } = await setup()

    const signed = await builder()
      .useGasKey(2)
      .nonce(777n)
      .transfer("bob.near", "1 NEAR")
      .sign()

    expect(signed.getHash()).toBeTruthy()
    const decoded = TransactionV1Schema.deserialize(
      signed.serialize().slice(1, -65),
    )
    expect(decoded.nonce).toEqual({
      gasKeyNonce: { nonce: 777n, nonceIndex: 2 },
    })
    // One slot-existence check; the slot's on-chain nonce is not used.
    expect(counters.gasKeyNonceCalls).toBe(1)
    expect(counters.accessKeyCalls).toBe(0)
  })

  test("rejects an out-of-range gas-key slot before signing", async () => {
    const { builder } = await setup()
    let signerCalls = 0
    const tx = builder()
    tx.signWith(async () => {
      signerCalls++
      throw new Error("must not sign")
    })

    // The mock key has 4 slots (0..3).
    await expect(
      tx.useGasKey(5).nonce(777n).transfer("bob.near", "1 NEAR").sign(),
    ).rejects.toBeInstanceOf(NearError)
    expect(signerCalls).toBe(0)
  })

  test("accepts a valid slot whose on-chain nonce exceeds Number.MAX_SAFE_INTEGER", async () => {
    // The slot's current nonce isn't used with an explicit nonce, so a value
    // that doesn't fit a JavaScript number must not block signing.
    const { builder } = await setup({
      slotNonces: [100, Number.MAX_SAFE_INTEGER + 2],
    })

    const signed = await builder()
      .useGasKey(1)
      .nonce(0xffff_ffff_ffff_fff0n)
      .transfer("bob.near", "1 NEAR")
      .sign()

    expect(signed.getHash()).toBeTruthy()
  })

  test("send() refuses an explicit nonce with a wallet, before prompting", async () => {
    const { rpc, keyStore, accountId } = await setup()
    let walletCalls = 0
    const wallet = {
      async getAccounts() {
        return []
      },
      async signAndSendTransaction() {
        walletCalls++
        throw new Error("must not prompt")
      },
    } as unknown as WalletConnection
    const tx = new TransactionBuilder(
      accountId,
      rpc,
      keyStore,
      undefined,
      "EXECUTED_OPTIMISTIC",
      wallet,
    )

    await expect(
      tx.nonce(42n).transfer("bob.near", "1 NEAR").send(),
    ).rejects.toThrow(/wallet chooses the transaction nonce/)
    expect(walletCalls).toBe(0)
  })

  test("produces the same bytes as a cache-allocated transaction with that nonce", async () => {
    const { builder } = await setup({ chainNonce: 10 })

    // The cache allocates chain nonce + 1 = 11 for the first transaction.
    const allocated = await builder().transfer("bob.near", "1 NEAR").sign()
    const pinned = await builder()
      .nonce(11n)
      .transfer("bob.near", "1 NEAR")
      .sign()

    expect(pinned.getHash()).toBe(allocated.getHash())
    expect(pinned.serialize()).toEqual(allocated.serialize())
  })

  test("changing the nonce invalidates a signed transaction", async () => {
    const { builder } = await setup()
    const tx = builder().nonce(1n).transfer("bob.near", "1 NEAR")

    const first = (await tx.sign()).getHash()
    const second = (await tx.nonce(2n).sign()).getHash()

    expect(second).not.toBe(first)
  })

  test("send() preserves a caller-owned nonce and reconciles rejection without re-signing", async () => {
    const { rpc, keyStore, accountId } = await setup()
    rpc.getTransactionStatus = async () => {
      throw new Error("not visible")
    }
    let submissions = 0
    const transport = rpcToPromises(
      testRpcPrograms(
        "https://rpc.invalid",
        async (_url, init) => {
          if (typeof init.body !== "string")
            throw new Error("Expected RPC JSON")
          const request = JSON.parse(init.body) as {
            id: number
            method: string
          }
          expect(request.method).toBe("send_tx")
          submissions++
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              name: "HANDLER_ERROR",
              code: -32000,
              message: "nonce rejected",
              cause: { name: "INVALID_TRANSACTION", info: {} },
              data: {
                TxExecutionError: {
                  InvalidTxError: {
                    InvalidNonce: { tx_nonce: 42, ak_nonce: 50 },
                  },
                },
              },
            },
          })
        },
        undefined,
        { maxRetries: 0 },
      ),
    )
    const tx = new TransactionBuilder(
      accountId,
      {
        ...rpc,
        sendTransaction: (bytes, waitUntil) =>
          transport.sendTransaction(bytes, waitUntil),
      },
      keyStore,
    )
    await expect(
      tx.nonce(42n).transfer("bob.near", "1 NEAR").send(),
    ).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
      data: { cause: expect.any(InvalidNonceError) },
    })
    expect(submissions).toBe(1)
  })

  test.each([
    [0n],
    [-1n],
    [0x1_0000_0000_0000_0000n],
    [0],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
  ])("rejects an invalid nonce %s", async (value) => {
    const { builder } = await setup()
    expect(() => builder().nonce(value)).toThrow(NearError)
  })
})
