/**
 * Unit tests for RPC retry logic and nonce retry handling
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import type { AccessKeyView, StatusResponse } from "../../src/core/types.js"
import { InvalidNonceError, NetworkError } from "../../src/errors/index.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"

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
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
      attemptCount++
      // Always fail with 503 Service Unavailable (retryable)
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        statusText: "Service Unavailable",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = new RpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).toThrow(NetworkError)

    // Should try initial + 3 retries = 4 total attempts
    expect(attemptCount).toBe(4)
  }, 10000)

  test("should not retry on non-retryable error (400 Bad Request)", async () => {
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      // Fail with 400 Bad Request (not retryable)
      return new Response(JSON.stringify({ error: "Bad Request" }), {
        status: 400,
        statusText: "Bad Request",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = new RpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 3, initialDelayMs: 50 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).toThrow(NetworkError)

    // Should only try once (no retries for non-retryable errors)
    expect(attemptCount).toBe(1)
  }, 10000)

  test("should retry on 408 Request Timeout", async () => {
    let attemptCount = 0
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
      attemptCount++
      // Always fail
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        statusText: "Service Unavailable",
      })
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    // Custom config: max 2 retries, 25ms initial delay
    const rpc = new RpcClient(
      "https://test.rpc.near.org",
      {},
      { maxRetries: 2, initialDelayMs: 25 },
    )

    await expect(async () => {
      await rpc.call("test_method", {})
    }).toThrow(NetworkError)

    // Should try initial + 2 retries = 3 total attempts
    expect(attemptCount).toBe(3)
  }, 10000)

  test("should not retry on successful request (happy path)", async () => {
    let attemptCount = 0
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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

    const mockFetch = mock(async () => {
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

    const rpc = new RpcClient(
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
  test("should retry transaction with fresh nonce after InvalidNonceError", async () => {
    // Setup
    const keyPair = generateKey()
    const keyStore = new InMemoryKeyStore()
    await keyStore.add("test.near", keyPair)

    let sendAttemptCount = 0
    let getAccessKeyCallCount = 0

    // Create a mock RPC client
    const mockRpc = {
      async getAccessKey(): Promise<AccessKeyView> {
        getAccessKeyCallCount++
        // Return increasing nonce on each call (simulating fresh nonce)
        return {
          nonce: getAccessKeyCallCount * 10,
          permission: "FullAccess",
          block_height: 12345,
          block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
        }
      },
      async getStatus(): Promise<StatusResponse> {
        return {
          sync_info: {
            latest_block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
          },
        } as StatusResponse
      },
      async sendTransaction() {
        sendAttemptCount++
        if (sendAttemptCount === 1) {
          // First attempt: throw InvalidNonceError
          throw new InvalidNonceError(11, 10)
        }
        // Second attempt: succeed
        return {
          final_execution_status: "EXECUTED_OPTIMISTIC",
          status: { type: "SuccessValue", value: "" },
          transaction: {},
          transaction_outcome: {
            id: "test-tx-id",
            outcome: {
              status: { type: "SuccessValue", value: "" },
            },
          },
        }
      },
    } as unknown as RpcClient

    // Create transaction builder
    const builder = new TransactionBuilder(
      "test.near",
      mockRpc,
      keyStore,
      undefined,
      "EXECUTED_OPTIMISTIC",
    )

    // Execute transaction that will trigger nonce retry
    const result = await builder.transfer("receiver.near", "1 NEAR").send()

    // Verify retry happened
    expect(sendAttemptCount).toBe(2) // Should try twice
    expect(getAccessKeyCallCount).toBe(2) // Should fetch nonce twice
    expect(result).toBeDefined()
  }, 10000)

  test("should throw after max nonce retries", async () => {
    // Setup
    const keyPair = generateKey()
    const keyStore = new InMemoryKeyStore()
    await keyStore.add("test.near", keyPair)

    let sendAttemptCount = 0

    // Create a mock RPC client that always fails with InvalidNonceError
    const mockRpc = {
      async getAccessKey(): Promise<AccessKeyView> {
        return {
          nonce: 10,
          permission: "FullAccess",
          block_height: 12345,
          block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
        }
      },
      async getStatus(): Promise<StatusResponse> {
        return {
          sync_info: {
            latest_block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
          },
        } as StatusResponse
      },
      async sendTransaction() {
        sendAttemptCount++
        // Always throw InvalidNonceError
        throw new InvalidNonceError(11, 10)
      },
    } as unknown as RpcClient

    // Create transaction builder
    const builder = new TransactionBuilder(
      "test.near",
      mockRpc,
      keyStore,
      undefined,
      "EXECUTED_OPTIMISTIC",
    )

    // Execute transaction that will exhaust retries
    await expect(async () => {
      await builder.transfer("receiver.near", "1 NEAR").send()
    }).toThrow(InvalidNonceError)

    // Verify it tried MAX_NONCE_RETRIES (3) times
    expect(sendAttemptCount).toBe(3)
  }, 10000)

  test("should not retry on non-InvalidNonceError", async () => {
    // Setup
    const keyPair = generateKey()
    const keyStore = new InMemoryKeyStore()
    await keyStore.add("test.near", keyPair)

    let sendAttemptCount = 0

    // Create a mock RPC client that throws a different error
    const mockRpc = {
      async getAccessKey(): Promise<AccessKeyView> {
        return {
          nonce: 10,
          permission: "FullAccess",
          block_height: 12345,
          block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
        }
      },
      async getStatus(): Promise<StatusResponse> {
        return {
          sync_info: {
            latest_block_hash: "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL",
          },
        } as StatusResponse
      },
      async sendTransaction() {
        sendAttemptCount++
        // Throw a different error (not InvalidNonceError)
        throw new NetworkError("Network failure")
      },
    } as unknown as RpcClient

    // Create transaction builder
    const builder = new TransactionBuilder(
      "test.near",
      mockRpc,
      keyStore,
      undefined,
      "EXECUTED_OPTIMISTIC",
    )

    // Execute transaction
    await expect(async () => {
      await builder.transfer("receiver.near", "1 NEAR").send()
    }).toThrow(NetworkError)

    // Verify it only tried once (no retries for non-nonce errors)
    expect(sendAttemptCount).toBe(1)
  }, 10000)
})
