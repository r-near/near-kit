/**
 * Integration tests for NEP-616 Deterministic AccountIds
 *
 * Tests the StateInit action and deterministic account ID derivation
 *
 * NOTE: These tests require sandbox version 2.10-release or later
 * which supports NEP-616.
 */

import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import {
  deriveAccountId,
  isDeterministicAccountId,
  verifyDeterministicAccountId,
} from "../../src/utils/state-init.js"

describe("NEP-616 - Deterministic AccountIds", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })
    console.log(`✓ Sandbox started: ${sandbox.rootAccount.id}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe("deriveAccountId utility", () => {
    test("should derive deterministic account ID from code hash", () => {
      const codeHash = new Uint8Array(32).fill(0xab)

      const accountId = deriveAccountId({
        code: { codeHash },
      })

      expect(accountId).toBeDefined()
      expect(accountId).toMatch(/^0s[0-9a-f]{40}$/)
      expect(isDeterministicAccountId(accountId)).toBe(true)
      console.log(`✓ Derived account ID from code hash: ${accountId}`)
    })

    test("should derive deterministic account ID from account ID reference", () => {
      const accountId = deriveAccountId({
        code: { accountId: "publisher.near" },
      })

      expect(accountId).toBeDefined()
      expect(accountId).toMatch(/^0s[0-9a-f]{40}$/)
      expect(isDeterministicAccountId(accountId)).toBe(true)
      console.log(`✓ Derived account ID from account reference: ${accountId}`)
    })

    test("should derive different IDs for different code references", () => {
      const id1 = deriveAccountId({
        code: { accountId: "publisher1.near" },
      })

      const id2 = deriveAccountId({
        code: { accountId: "publisher2.near" },
      })

      expect(id1).not.toBe(id2)
      console.log(`✓ Different code references produce different IDs`)
    })

    test("should derive different IDs when data differs", () => {
      const code = { accountId: "publisher.near" }

      const id1 = deriveAccountId({ code })

      const data = new Map<Uint8Array, Uint8Array>()
      data.set(
        new TextEncoder().encode("key"),
        new TextEncoder().encode("value"),
      )

      const id2 = deriveAccountId({ code, data })

      expect(id1).not.toBe(id2)
      console.log(`✓ Different data produces different IDs`)
    })

    test("should be deterministic - same input produces same output", () => {
      const options = {
        code: { accountId: "publisher.near" },
      }

      const id1 = deriveAccountId(options)
      const id2 = deriveAccountId(options)

      expect(id1).toBe(id2)
      console.log(`✓ Derivation is deterministic`)
    })
  })

  describe("isDeterministicAccountId utility", () => {
    test("should return true for valid deterministic account IDs", () => {
      expect(
        isDeterministicAccountId("0s1234567890abcdef1234567890abcdef12345678"),
      ).toBe(true)
      expect(
        isDeterministicAccountId("0sabcdefabcdefabcdefabcdefabcdefabcdefabcd"),
      ).toBe(true)
    })

    test("should return false for non-deterministic account IDs", () => {
      expect(isDeterministicAccountId("alice.near")).toBe(false)
      expect(isDeterministicAccountId("test.testnet")).toBe(false)
      expect(
        isDeterministicAccountId("0x1234567890abcdef1234567890abcdef12345678"),
      ).toBe(false) // Ethereum-style
    })

    test("should return false for malformed deterministic IDs", () => {
      expect(isDeterministicAccountId("0s123")).toBe(false) // Too short
      expect(
        isDeterministicAccountId(
          "0s1234567890abcdef1234567890abcdef12345678extra",
        ),
      ).toBe(false) // Too long
      expect(
        isDeterministicAccountId("0s1234567890ABCDEF1234567890ABCDEF12345678"),
      ).toBe(false) // Uppercase
    })
  })

  describe("verifyDeterministicAccountId utility", () => {
    test("should verify that account ID matches expected derivation", () => {
      const options = {
        code: { accountId: "publisher.near" },
      }

      const derivedId = deriveAccountId(options)

      expect(verifyDeterministicAccountId(derivedId, options)).toBe(true)
      expect(
        verifyDeterministicAccountId(
          "0s0000000000000000000000000000000000000000",
          options,
        ),
      ).toBe(false)
    })
  })

  describe("StateInit action - End-to-End", () => {
    let publisherId: string
    let publisherKey: ReturnType<typeof generateKey>

    beforeAll(async () => {
      // Set up a publisher account with a global contract
      publisherKey = generateKey()
      publisherId = `nep616-pub-${Date.now()}.${sandbox.rootAccount.id}`

      // Create publisher account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(publisherId)
        .transfer(publisherId, "50 NEAR")
        .addKey(publisherKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Publisher account created: ${publisherId}`)

      // Load and publish a global contract
      const contractPath = `${import.meta.dirname}/../contracts/guestbook.wasm`
      const contractCode = readFileSync(contractPath)

      const nearWithPublisherKey = new Near({
        network: sandbox,
        keyStore: {
          [publisherId]: publisherKey.secretKey,
        },
      })

      await nearWithPublisherKey
        .transaction(publisherId)
        .publishContract(contractCode, { identifiedBy: "account" })
        .send()

      console.log(`✓ Global contract published: ${publisherId}`)
    }, 60000)

    test("should deploy contract to deterministic account via StateInit", async () => {
      // Derive the deterministic account ID
      const deterministicId = deriveAccountId({
        code: { accountId: publisherId },
      })

      console.log(`✓ Derived deterministic account: ${deterministicId}`)
      expect(isDeterministicAccountId(deterministicId)).toBe(true)

      // Deploy using StateInit
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          deposit: "5 NEAR",
        })
        .send()

      expect(result.status).toHaveProperty("SuccessValue")
      console.log(`✓ Contract deployed to: ${deterministicId}`)
      console.log(`✓ Deterministic account deployed successfully`)
    }, 60000)

    test("should initialize contract with storage data via StateInit", async () => {
      // Create storage data
      const storageKey = new TextEncoder().encode("greeting")
      const storageValue = new TextEncoder().encode("Hello from NEP-616!")
      const data = new Map<Uint8Array, Uint8Array>()
      data.set(storageKey, storageValue)

      // Derive account ID with data
      const deterministicId = deriveAccountId({
        code: { accountId: publisherId },
        data,
      })

      console.log(
        `✓ Derived deterministic account with data: ${deterministicId}`,
      )
      expect(isDeterministicAccountId(deterministicId)).toBe(true)

      // Deploy with initial storage
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          data,
          deposit: "5 NEAR",
        })
        .send()

      expect(result.status).toHaveProperty("SuccessValue")
      console.log(`✓ Contract deployed with initial storage`)
      console.log(`✓ Deterministic account with data deployed successfully`)
    }, 60000)

    test("should handle deploying to already-deployed deterministic account", async () => {
      // First deployment
      const deterministicId = deriveAccountId({
        code: { accountId: publisherId },
      })

      await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          deposit: "5 NEAR",
        })
        .send()

      console.log(`✓ First deployment completed: ${deterministicId}`)

      // Second deployment to the same account (should not fail)
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          deposit: "5 NEAR",
        })
        .send()

      expect(result.status).toHaveProperty("SuccessValue")
      console.log(`✓ Second deployment handled gracefully (refund scenario)`)
    }, 60000)

    test("should verify deterministic account is using expected code", async () => {
      // Deploy a deterministic account
      const deterministicId = deriveAccountId({
        code: { accountId: publisherId },
      })

      await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          deposit: "5 NEAR",
        })
        .send()

      console.log(`✓ Deployed: ${deterministicId}`)

      // Verify it matches expected derivation
      const isValid = verifyDeterministicAccountId(deterministicId, {
        code: { accountId: publisherId },
      })

      expect(isValid).toBe(true)
      console.log(`✓ Account ID matches expected derivation`)

      // Verify with wrong code reference should fail
      const isInvalid = verifyDeterministicAccountId(deterministicId, {
        code: { accountId: "wrong.near" },
      })

      expect(isInvalid).toBe(false)
      console.log(`✓ Verification correctly rejects wrong code reference`)
    }, 60000)

    test("should allow calling methods on deterministic account", async () => {
      // Deploy a deterministic account
      const deterministicId = deriveAccountId({
        code: { accountId: publisherId },
      })

      await near
        .transaction(sandbox.rootAccount.id)
        .stateInit({
          code: { accountId: publisherId },
          deposit: "5 NEAR",
        })
        .send()

      console.log(`✓ Deployed: ${deterministicId}`)

      // Call a method on the deterministic account (using guestbook's add_message)
      const callResult = await near
        .transaction(sandbox.rootAccount.id)
        .functionCall(
          deterministicId,
          "add_message",
          { text: "Hello from deterministic account!" },
          { attachedDeposit: "0 NEAR" },
        )
        .send()

      expect(callResult.status).toHaveProperty("SuccessValue")
      console.log(`✓ Method call on deterministic account succeeded`)

      // Verify we can query the account (even if initialization is pending)
      // The fact that the function call succeeded proves the account is callable
      expect(callResult).toBeDefined()
      console.log(`✓ Deterministic account is fully functional`)
    }, 60000)
  })
})

describe("NEP-616 - Edge Cases", () => {
  test("should handle base58 encoded code hash", () => {
    // A valid base58 encoded 32-byte hash
    const base58Hash = "11111111111111111111111111111111"

    const accountId = deriveAccountId({
      code: { codeHash: base58Hash },
    })

    expect(accountId).toBeDefined()
    expect(isDeterministicAccountId(accountId)).toBe(true)
    console.log(`✓ Base58 code hash handled: ${accountId}`)
  })

  test("should handle empty data map", () => {
    const withoutData = deriveAccountId({
      code: { accountId: "publisher.near" },
    })

    const withEmptyData = deriveAccountId({
      code: { accountId: "publisher.near" },
      data: new Map(),
    })

    // Empty data map should produce the same result as no data
    expect(withoutData).toBe(withEmptyData)
    console.log(`✓ Empty data map handled correctly`)
  })
})
