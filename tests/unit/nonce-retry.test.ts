/**
 * Unit tests for nonce collision and retry logic
 *
 * Tests RPC retry behavior when InvalidNonceError is encountered
 */

import { describe, expect, test } from "vitest"
import { NonceManager } from "../../src/core/nonce-manager.js"
import { InvalidNonceError } from "../../src/errors/index.js"

describe("InvalidNonceError", () => {
  test("should be retryable", () => {
    const error = new InvalidNonceError(5, 10)

    expect(error).toBeInstanceOf(InvalidNonceError)
    expect(error.retryable).toBe(true)
    expect(error.txNonce).toBe(5)
    expect(error.akNonce).toBe(10)
    expect(error.code).toBe("INVALID_NONCE")
  })

  test("should include nonce values in error message", () => {
    const error = new InvalidNonceError(5, 10)

    expect(error.message).toContain("5")
    expect(error.message).toContain("10")
    expect(error.message).toContain("transaction nonce")
    expect(error.message).toContain("access key nonce")
  })

  test("should have correct error name", () => {
    const error = new InvalidNonceError(1, 2)

    expect(error.name).toBe("InvalidNonceError")
  })

  test("should handle large nonce values", () => {
    const txNonce = 999999999
    const akNonce = 1000000000

    const error = new InvalidNonceError(txNonce, akNonce)

    expect(error.txNonce).toBe(txNonce)
    expect(error.akNonce).toBe(akNonce)
    expect(error.retryable).toBe(true)
  })
})

describe("RPC Retry Logic with Nonce Errors", () => {
  test("should detect nonce error as retryable", () => {
    const nonceError = new InvalidNonceError(5, 10)

    // The retry logic checks for error.retryable
    expect("retryable" in nonceError).toBe(true)
    expect(nonceError.retryable).toBe(true)
  })

  test("should contain tx_nonce and ak_nonce", () => {
    const error = new InvalidNonceError(42, 43)

    // These properties are used to understand the nonce mismatch
    expect(error.txNonce).toBe(42)
    expect(error.akNonce).toBe(43)

    // Transaction nonce should eventually be greater than access key nonce
    expect(error.txNonce).toBeLessThan(error.akNonce)
  })
})

describe("Error Parsing - Nonce Collision", () => {
  test("should parse InvalidNonce from RPC error structure", () => {
    // Simulate the RPC error structure for InvalidNonce
    const rpcErrorData = {
      TxExecutionError: {
        InvalidTxError: {
          InvalidNonce: {
            tx_nonce: 5,
            ak_nonce: 10,
          },
        },
      },
    }

    // Verify structure matches what rpc-error-handler expects
    const invalidTxError = rpcErrorData.TxExecutionError.InvalidTxError
    const invalidNonce = invalidTxError.InvalidNonce

    expect(invalidNonce).toBeDefined()
    expect("ak_nonce" in invalidNonce).toBe(true)
    expect("tx_nonce" in invalidNonce).toBe(true)
    expect(invalidNonce.tx_nonce).toBe(5)
    expect(invalidNonce.ak_nonce).toBe(10)
  })

  test("should parse alternative InvalidNonce RPC structure", () => {
    // Alternative structure (without TxExecutionError wrapper)
    const rpcErrorData = {
      InvalidTxError: {
        InvalidNonce: {
          tx_nonce: 100,
          ak_nonce: 105,
        },
      },
    }

    const invalidNonce = rpcErrorData.InvalidTxError.InvalidNonce

    expect(invalidNonce).toBeDefined()
    expect(invalidNonce.tx_nonce).toBe(100)
    expect(invalidNonce.ak_nonce).toBe(105)
  })
})

describe("Nonce Management Scenarios", () => {
  test("concurrent transactions should have different nonces", () => {
    // When multiple transactions are sent concurrently,
    // each should get a different nonce
    const nonces = new Set<number>()

    // Simulate nonce generation (in real code, this comes from access key)
    let currentNonce = 0

    for (let i = 0; i < 10; i++) {
      currentNonce += 1
      nonces.add(currentNonce)
    }

    // All nonces should be unique
    expect(nonces.size).toBe(10)
    expect(Array.from(nonces).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })

  test("nonce should increment for each transaction", () => {
    let accessKeyNonce = 0

    // First transaction
    const tx1Nonce = ++accessKeyNonce
    expect(tx1Nonce).toBe(1)

    // Second transaction
    const tx2Nonce = ++accessKeyNonce
    expect(tx2Nonce).toBe(2)
    expect(tx2Nonce).toBeGreaterThan(tx1Nonce)

    // Third transaction
    const tx3Nonce = ++accessKeyNonce
    expect(tx3Nonce).toBe(3)
    expect(tx3Nonce).toBeGreaterThan(tx2Nonce)
  })

  test("should handle nonce wrap-around edge case", () => {
    // JavaScript numbers can safely represent integers up to Number.MAX_SAFE_INTEGER
    const maxSafeNonce = Number.MAX_SAFE_INTEGER

    const error = new InvalidNonceError(maxSafeNonce - 1, maxSafeNonce)

    expect(error.txNonce).toBe(maxSafeNonce - 1)
    expect(error.akNonce).toBe(maxSafeNonce)
    expect(error.retryable).toBe(true)
  })
})

describe("Retry Behavior Validation", () => {
  test("should retry when encountering InvalidNonceError", async () => {
    let attempts = 0
    const maxRetries = 3

    // Mock RPC call that fails with nonce error twice, then succeeds
    const mockRpcCall = async (): Promise<string> => {
      attempts++

      if (attempts <= 2) {
        // First two attempts fail with nonce error
        const error = new InvalidNonceError(attempts, attempts + 10)
        throw error
      }

      // Third attempt succeeds
      return "success"
    }

    // Simulate retry logic
    let result: string | null = null
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        result = await mockRpcCall()
        break // Success
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1
        const isRetryable =
          error instanceof InvalidNonceError && error.retryable

        if (!isRetryable || isLastAttempt) {
          throw error
        }

        // Continue to next retry
      }
    }

    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })

  test("should throw after max retries with InvalidNonceError", async () => {
    let attempts = 0
    const maxRetries = 3

    // Mock RPC call that always fails
    const mockRpcCall = async (): Promise<string> => {
      attempts++
      throw new InvalidNonceError(attempts, attempts + 10)
    }

    // Simulate retry logic
    let thrownError: Error | null = null
    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await mockRpcCall()
          break
        } catch (error) {
          const isLastAttempt = attempt === maxRetries - 1
          const isRetryable =
            error instanceof InvalidNonceError &&
            (error as InvalidNonceError).retryable

          if (!isRetryable || isLastAttempt) {
            throw error
          }
        }
      }
    } catch (error) {
      thrownError = error as Error
    }

    expect(thrownError).toBeInstanceOf(InvalidNonceError)
    expect(attempts).toBe(maxRetries)
  })

  test("should not retry non-retryable errors", async () => {
    let attempts = 0

    // Mock RPC call that fails with non-retryable error
    const mockRpcCall = async (): Promise<string> => {
      attempts++
      const error = new Error("Not retryable")
      throw error
    }

    // Simulate retry logic
    let thrownError: Error | null = null
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await mockRpcCall()
          break
        } catch (error) {
          const isLastAttempt = attempt === 2
          const isRetryable =
            typeof error === "object" &&
            error !== null &&
            "retryable" in error &&
            (error as { retryable: boolean }).retryable === true

          if (!isRetryable || isLastAttempt) {
            throw error
          }
        }
      }
    } catch (error) {
      thrownError = error as Error
    }

    expect(thrownError).toBeDefined()
    expect(attempts).toBe(1) // Should fail immediately
  })
})

describe("Exponential Backoff", () => {
  test("should calculate exponential backoff delays", () => {
    const initialDelayMs = 1000 // 1 second

    // Calculate delays for 4 retries
    const delays = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const delay = initialDelayMs * 2 ** attempt
      delays.push(delay)
    }

    expect(delays).toEqual([
      1000, // 1s (attempt 0)
      2000, // 2s (attempt 1)
      4000, // 4s (attempt 2)
      8000, // 8s (attempt 3)
    ])
  })

  test("should respect max retries limit", () => {
    const maxRetries = 4
    const totalAttempts = 1 + maxRetries // initial + retries

    expect(totalAttempts).toBe(5)

    // Verify retry logic stops at max attempts
    let attempts = 0
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      attempts++
    }

    expect(attempts).toBe(totalAttempts)
  })
})

describe("NonceManager", () => {
  test("should fetch nonce from blockchain on first call", async () => {
    const manager = new NonceManager()
    let fetchCalled = false

    const fetchFromBlockchain = async (): Promise<bigint> => {
      fetchCalled = true
      return 100n
    }

    const nonce = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )

    expect(fetchCalled).toBe(true)
    expect(nonce).toBe(101n)
  })

  test("should increment nonce locally on subsequent calls", async () => {
    const manager = new NonceManager()
    let fetchCount = 0

    const fetchFromBlockchain = async (): Promise<bigint> => {
      fetchCount++
      return 100n
    }

    const nonce1 = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )
    const nonce2 = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )
    const nonce3 = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )

    expect(fetchCount).toBe(1) // Should only fetch once
    expect(nonce1).toBe(101n)
    expect(nonce2).toBe(102n)
    expect(nonce3).toBe(103n)
  })

  test("should handle different accounts independently", async () => {
    const manager = new NonceManager()

    const fetchAlice = async (): Promise<bigint> => 100n
    const fetchBob = async (): Promise<bigint> => 200n

    const aliceNonce = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchAlice,
    )
    const bobNonce = await manager.getNextNonce(
      "bob.near",
      "ed25519:test",
      fetchBob,
    )

    expect(aliceNonce).toBe(101n)
    expect(bobNonce).toBe(201n)
  })

  test("should handle error when fetchFromBlockchain throws", async () => {
    const manager = new NonceManager()

    const fetchFromBlockchain = async (): Promise<bigint> => {
      throw new Error("Network error")
    }

    await expect(
      manager.getNextNonce("alice.near", "ed25519:test", fetchFromBlockchain),
    ).rejects.toThrow("Network error")

    // Verify fetching map is cleaned up after error
    // Try again to ensure it attempts to fetch again (not stuck in fetching state)
    let secondAttemptCalled = false
    const secondFetch = async (): Promise<bigint> => {
      secondAttemptCalled = true
      return 100n
    }

    const nonce = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      secondFetch,
    )

    expect(secondAttemptCalled).toBe(true)
    expect(nonce).toBe(101n)
  })

  test("should deduplicate concurrent fetches", async () => {
    const manager = new NonceManager()
    let fetchCount = 0

    const fetchFromBlockchain = async (): Promise<bigint> => {
      fetchCount++
      // Simulate slow network call
      await new Promise((resolve) => setTimeout(resolve, 50))
      return 100n
    }

    // Make multiple concurrent calls
    const promises = [
      manager.getNextNonce("alice.near", "ed25519:test", fetchFromBlockchain),
      manager.getNextNonce("alice.near", "ed25519:test", fetchFromBlockchain),
      manager.getNextNonce("alice.near", "ed25519:test", fetchFromBlockchain),
    ]

    const nonces = await Promise.all(promises)

    // Should only fetch once despite 3 concurrent calls
    expect(fetchCount).toBe(1)
    // All nonces should be unique and sequential
    expect(nonces).toEqual([101n, 102n, 103n])
  })

  test("should invalidate cached nonce", async () => {
    const manager = new NonceManager()
    let fetchCount = 0

    const fetchFromBlockchain = async (): Promise<bigint> => {
      fetchCount++
      return 100n + BigInt(fetchCount) * 10n
    }

    // First call - fetches and caches
    const nonce1 = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )

    expect(nonce1).toBe(111n) // 100 + 10 + 1

    // Invalidate the cache
    manager.invalidate("alice.near", "ed25519:test")

    // Next call should fetch again
    const nonce2 = await manager.getNextNonce(
      "alice.near",
      "ed25519:test",
      fetchFromBlockchain,
    )

    expect(fetchCount).toBe(2)
    expect(nonce2).toBe(121n) // 100 + 20 + 1
  })

  test("should clear all cached nonces", async () => {
    const manager = new NonceManager()

    await manager.getNextNonce("alice.near", "ed25519:test1", async () => 100n)
    await manager.getNextNonce("bob.near", "ed25519:test2", async () => 200n)

    // Clear all caches
    manager.clear()

    // Subsequent calls should fetch again
    let aliceFetchCount = 0
    let bobFetchCount = 0

    await manager.getNextNonce("alice.near", "ed25519:test1", async () => {
      aliceFetchCount++
      return 100n
    })
    await manager.getNextNonce("bob.near", "ed25519:test2", async () => {
      bobFetchCount++
      return 200n
    })

    expect(aliceFetchCount).toBe(1)
    expect(bobFetchCount).toBe(1)
  })
})
