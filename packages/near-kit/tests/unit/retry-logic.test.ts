/**
 * Unit tests for RPC retry logic and nonce retry handling
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Effect } from "effect"
import { rpcToPromises } from "../../src/core/rpc/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InvalidNonceError, NetworkError } from "../../src/errors/index.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"
import { testRpcClient, testRpcPrograms } from "../helpers/rpc.js"

describe("RPC Retry Logic", () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test("should retry on retryable NetworkError with exponential backoff", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 3) {
        // Fail with 503 Service Unavailable (retryable)
        return new Response(JSON.stringify({ error: "Service Unavailable" }), {
          status: 503,
          statusText: "Service Unavailable",
        })
      }
      // Succeed on 3rd attempt
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 4, initialDelayMs: 100 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(3)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 10000)

  test("should throw after max retries on persistent retryable error", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      // Always fail with 503 Service Unavailable (retryable)
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        statusText: "Service Unavailable",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).rejects.toThrow(NetworkError)

    // Should try initial + 3 retries = 4 total attempts
    expect(attemptCount).toBe(4)
  }, 10000)

  test("should not retry on non-retryable error (400 Bad Request)", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      // Fail with 400 Bad Request (not retryable)
      return new Response(JSON.stringify({ error: "Bad Request" }), {
        status: 400,
        statusText: "Bad Request",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).rejects.toThrow(NetworkError)

    // Should only try once (no retries for non-retryable errors)
    expect(attemptCount).toBe(1)
  }, 10000)

  test("should retry on 408 Request Timeout", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        // Fail with 408 Request Timeout (retryable)
        return new Response(JSON.stringify({ error: "Request Timeout" }), {
          status: 408,
          statusText: "Request Timeout",
        })
      }
      // Succeed on 2nd attempt
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(2)
  }, 10000)

  test("should retry on 429 Too Many Requests", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        // Fail with 429 Too Many Requests (retryable)
        return new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          statusText: "Too Many Requests",
        })
      }
      // Succeed on 2nd attempt
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(2)
  }, 10000)

  test("should retry on network fetch failure", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        // Simulate network failure
        throw new Error("fetch failed")
      }
      // Succeed on 2nd attempt
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(2)
  }, 10000)

  test("should respect custom retry configuration", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      // Always fail
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        statusText: "Service Unavailable",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    // Custom config: max 2 retries, 25ms initial delay
    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 2, initialDelayMs: 25 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).rejects.toThrow(NetworkError)

    // Should try initial + 2 retries = 3 total attempts
    expect(attemptCount).toBe(3)
  }, 10000)

  test("should not retry on successful request (happy path)", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      // Succeed immediately
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(1) // Should only try once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  }, 10000)

  test("should retry on 500 Internal Server Error", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response(
          JSON.stringify({ error: "Internal Server Error" }),
          {
            status: 500,
            statusText: "Internal Server Error",
          },
        )
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(2)
  }, 10000)

  test("should retry on 502 Bad Gateway", async () => {
    let attemptCount = 0
    const mockFetch = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response(JSON.stringify({ error: "Bad Gateway" }), {
          status: 502,
          statusText: "Bad Gateway",
        })
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )
    const result = await rpc.call<{ success: boolean }>("test_method", {})

    expect(result.success).toBe(true)
    expect(attemptCount).toBe(2)
  }, 10000)

  test("should use exponential backoff delays", async () => {
    const delays: number[] = []
    let lastTimestamp = Date.now()
    let attemptCount = 0

    const mockFetch = vi.fn(async () => {
      const now = Date.now()
      if (attemptCount > 0) {
        delays.push(now - lastTimestamp)
      }
      lastTimestamp = now
      attemptCount++

      if (attemptCount < 4) {
        return new Response(JSON.stringify({ error: "Service Unavailable" }), {
          status: 503,
          statusText: "Service Unavailable",
        })
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = testRpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 4, initialDelayMs: 100 },
    )
    await rpc.call<{ success: boolean }>("test_method", {})

    // Verify exponential backoff: 100ms, 200ms, 400ms
    // Allow ±50ms tolerance for timing
    expect(delays.length).toBe(3)
    expect(delays[0]).toBeGreaterThanOrEqual(80) // 100ms ±20ms
    expect(delays[0]).toBeLessThanOrEqual(150)
    expect(delays[1]).toBeGreaterThanOrEqual(180) // 200ms ±20ms
    expect(delays[1]).toBeLessThanOrEqual(250)
    expect(delays[2]).toBeGreaterThanOrEqual(380) // 400ms ±20ms
    expect(delays[2]).toBeLessThanOrEqual(450)
  }, 10000)
})

describe("InvalidNonceError Retry Logic", () => {
  test("InvalidNonceError should have retryable flag set to true", () => {
    const error = new InvalidNonceError(100, 99)
    expect(error.retryable).toBe(true)
    expect(error.txNonce).toBe(100)
    expect(error.akNonce).toBe(99)
    expect(error.code).toBe("INVALID_NONCE")
  })

  test("InvalidNonceError message should be descriptive", () => {
    const error = new InvalidNonceError(100, 99)
    expect(error.message).toContain("100")
    expect(error.message).toContain("99")
    expect(error.message).toContain("nonce")
  })
})

describe("Transaction InvalidNonceError Retry", () => {
  async function fixture(mode: "recover" | "reject" | "network") {
    const key = generateKey()
    const signing = vi.spyOn(key, "sign")
    const store = new InMemoryKeyStore()
    await store.add("test.near", key)
    const nonces: bigint[] = []
    let accessKeyCalls = 0
    const hash = "11111111111111111111111111111111"
    const programs = testRpcPrograms(
      "https://rpc.invalid",
      async (_url, init) => {
        if (typeof init.body !== "string") throw new Error("Expected RPC JSON")
        const request = JSON.parse(init.body) as {
          id: number
          method: string
          params: { signed_tx_base64?: string }
        }
        if (request.method !== "send_tx") {
          expect(request.method).toBe("EXPERIMENTAL_tx_status")
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              name: "HANDLER_ERROR",
              code: -32000,
              message: "Transaction is not visible",
              cause: { name: "UNKNOWN_TRANSACTION", info: {} },
            },
          })
        }
        if (typeof request.params.signed_tx_base64 !== "string")
          throw new Error("Expected signed transaction bytes")
        const bytes = Buffer.from(request.params.signed_tx_base64, "base64")
        const keyOffset = 4 + bytes.readUInt32LE(0)
        expect(bytes[keyOffset]).toBe(0) // V0 transaction, Ed25519 public key.
        const nonce = bytes.readBigUInt64LE(keyOffset + 33)
        nonces.push(nonce)
        if (mode === "network") throw new NetworkError("Network failure")
        if (mode === "reject" || nonces.length === 1)
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
                    InvalidNonce: {
                      tx_nonce: Number(nonce),
                      ak_nonce: Number(nonce),
                    },
                  },
                },
              },
            },
          })
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: { final_execution_status: "NONE" },
        })
      },
      undefined,
      { maxRetries: 0 },
    )
    // These read capabilities are unrelated to rejection provenance; submission uses
    // the actual transport, envelope decoder and error classifier above.
    const rpc = rpcToPromises({
      ...programs,
      getAccessKey: () =>
        Effect.sync(() => {
          accessKeyCalls++
          return {
            nonce: 10,
            permission: "FullAccess" as const,
            block_height: 12345,
            block_hash: hash,
          }
        }),
      getBlock: () =>
        Effect.succeed({
          author: "validator.near",
          chunks: [],
          header: {
            height: 12345,
            epoch_id: hash,
            next_epoch_id: hash,
            hash,
            prev_hash: hash,
            prev_state_root: hash,
            chunk_receipts_root: hash,
            chunk_headers_root: hash,
            chunk_tx_root: hash,
            outcome_root: hash,
            chunks_included: 0,
            challenges_root: hash,
            timestamp: 1,
            timestamp_nanosec: "1",
            random_value: hash,
            validator_proposals: [],
            chunk_mask: [],
            gas_price: "100000000",
            total_supply: "1000000000000000000000000000",
            challenges_result: [],
            last_final_block: hash,
            last_ds_final_block: hash,
            next_bp_hash: hash,
            block_merkle_root: hash,
            approvals: [],
            signature: "ed25519:fixture",
            latest_protocol_version: 85,
          },
        }),
    })
    const builder = new TransactionBuilder("test.near", rpc, store).transfer(
      "receiver.near",
      "1 NEAR",
    )
    return { builder, signing, nonces, accessKeyCalls: () => accessKeyCalls }
  }

  test("a decoded nonce rejection reconciles instead of authorizing fresh signing", async () => {
    const { builder, signing, nonces, accessKeyCalls } =
      await fixture("recover")
    await expect(builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
    })
    expect(nonces).toEqual([11n])
    expect(signing).toHaveBeenCalledTimes(1)
    expect(accessKeyCalls()).toBe(1)
    // An explicit caller replay keeps its prior commitment, even when a later
    // response succeeds. It never allocates a new nonce for this intent.
    const result = await builder.send({ waitUntil: "NONE" })
    expect(nonces).toEqual([11n, 11n])
    expect(signing).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ transaction: { hash: builder.getHash() } })
  })

  test("repeated node rejections never mint a second signed commitment", async () => {
    const { builder, signing, nonces } = await fixture("reject")
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        retryable: false,
      })
    }
    expect(nonces).toEqual([11n, 11n, 11n])
    expect(signing).toHaveBeenCalledTimes(1)
  })

  test("does not re-sign after an uncertain post-submission network failure", async () => {
    const { builder, signing, nonces } = await fixture("network")
    await expect(builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
    })
    expect(nonces).toHaveLength(1)
    expect(signing).toHaveBeenCalledTimes(1)
  })
})
