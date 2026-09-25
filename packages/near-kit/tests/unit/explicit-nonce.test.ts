/**
 * Unit tests for TransactionBuilder.nonce() — signing at a caller-chosen nonce.
 */

import { describe, expect, test } from "vitest"
import type { RpcClient } from "../../src/core/rpc/rpc.js"
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
  options: { chainNonce?: number; sendError?: Error } = {},
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
        return { nonces: [100, 200, 300, 400] }
      }
      throw new Error(`unexpected rpc call ${method}`)
    },
    async getBlock() {
      return { header: { hash: BLOCK_HASH, height: 12345 } }
    },
    async sendTransaction() {
      counters.sendCalls++
      if (options.sendError) throw options.sendError
      return {
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status: { SuccessValue: "" },
        transaction: {},
        transaction_outcome: { id: "tx", outcome: { status: {} } },
      }
    },
  } as unknown as RpcClient
}

async function setup(options: { chainNonce?: number; sendError?: Error } = {}) {
  // A unique account per test keeps the shared (static) NonceManager cache
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
    // The underlying u64 nonce is exposed on the V0-shaped signed transaction.
    expect(
      (
        signed as unknown as {
          cachedSignedTx: { signedTx: { transaction: { nonce: bigint } } }
        }
      ).cachedSignedTx.signedTx.transaction.nonce,
    ).toBe(777n)
    // One slot-existence check; the slot's on-chain nonce is not used.
    expect(counters.gasKeyNonceCalls).toBe(1)
    expect(counters.accessKeyCalls).toBe(0)
  })

  test("rejects an out-of-range gas-key slot before signing", async () => {
    const { builder } = await setup()
    let signerCalls = 0
    const tx = builder()
    ;(tx as unknown as { signer: unknown }).signer = async () => {
      signerCalls++
      throw new Error("must not sign")
    }

    // The mock key has 4 slots (0..3).
    await expect(
      tx.useGasKey(5).nonce(777n).transfer("bob.near", "1 NEAR").sign(),
    ).rejects.toBeInstanceOf(NearError)
    expect(signerCalls).toBe(0)
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

  test("send() surfaces InvalidNonceError instead of retrying a caller-owned nonce", async () => {
    const { builder, counters } = await setup({
      sendError: new InvalidNonceError(42, 50),
    })

    await expect(
      builder().nonce(42n).transfer("bob.near", "1 NEAR").send(),
    ).rejects.toBeInstanceOf(InvalidNonceError)
    expect(counters.sendCalls).toBe(1)
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
