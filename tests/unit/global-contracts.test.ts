import { describe, expect, test } from "bun:test"
import { base58 } from "@scure/base"
import { deployFromPublished, publishContract } from "../../src/core/actions.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { ActionSchema } from "../../src/core/schema.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"

describe("Global Contracts API", () => {
  test("publishContract creates updatable contract action by default", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d]) // WASM header
    const action = publishContract(code)

    expect(action).toHaveProperty("deployGlobalContract")
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ AccountId: {} })
  })

  test("publishContract creates immutable contract action with hash mode", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const action = publishContract(code, { identifiedBy: "hash" })

    expect(action).toHaveProperty("deployGlobalContract")
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ CodeHash: {} })
  })

  test("deployFromPublished with accountId", () => {
    const accountId = "contract-publisher.near"
    const action = deployFromPublished({ accountId })

    expect(action).toHaveProperty("useGlobalContract")
    expect(action.useGlobalContract.contractIdentifier).toEqual({
      AccountId: accountId,
    })
  })

  test("deployFromPublished with codeHash as Uint8Array", () => {
    const codeHash = new Uint8Array(32).fill(0xab)
    const action = deployFromPublished({ codeHash })

    expect(action).toHaveProperty("useGlobalContract")
    expect(action.useGlobalContract.contractIdentifier).toHaveProperty(
      "CodeHash",
    )
    expect(
      (action.useGlobalContract.contractIdentifier as { CodeHash: number[] })
        .CodeHash,
    ).toEqual(Array.from(codeHash))
  })

  test("deployFromPublished with codeHash as base58 string", () => {
    const hashBytes = new Uint8Array(32).fill(0xab)
    const codeHashBase58 = base58.encode(hashBytes)
    const action = deployFromPublished({ codeHash: codeHashBase58 })

    expect(action).toHaveProperty("useGlobalContract")
    expect(action.useGlobalContract.contractIdentifier).toHaveProperty(
      "CodeHash",
    )
    expect(
      (action.useGlobalContract.contractIdentifier as { CodeHash: number[] })
        .CodeHash,
    ).toEqual(Array.from(hashBytes))
  })

  test("deployFromPublished throws on invalid hash length", () => {
    const invalidHash = new Uint8Array(16) // Wrong length

    expect(() => {
      deployFromPublished({ codeHash: invalidHash })
    }).toThrow("Code hash must be 32 bytes")
  })

  test("deployFromPublished throws on invalid base58 hash length", () => {
    const invalidHashBytes = new Uint8Array(16)
    const invalidHashBase58 = base58.encode(invalidHashBytes)

    expect(() => {
      deployFromPublished({ codeHash: invalidHashBase58 })
    }).toThrow("Code hash must be 32 bytes")
  })
})

describe("Global Contracts API - Edge Cases", () => {
  describe("publishContract edge cases", () => {
    test("handles empty contract code", () => {
      const emptyCode = new Uint8Array(0)
      const action = publishContract(emptyCode, { identifiedBy: "hash" })

      expect(action).toHaveProperty("deployGlobalContract")
      expect(action.deployGlobalContract.code).toEqual(emptyCode)
      expect(action.deployGlobalContract.code.length).toBe(0)
    })

    test("handles very large contract code", () => {
      // Simulate a large contract (1MB)
      const largeCode = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeCode.length; i++) {
        largeCode[i] = i % 256
      }
      const action = publishContract(largeCode, { identifiedBy: "hash" })

      expect(action).toHaveProperty("deployGlobalContract")
      expect(action.deployGlobalContract.code.length).toBe(1024 * 1024)
      expect(action.deployGlobalContract.code).toEqual(largeCode)
    })

    test("handles contract code with special bytes", () => {
      const specialBytes = new Uint8Array([
        0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe, 0xaa, 0x55,
      ])
      const action = publishContract(specialBytes, { identifiedBy: "hash" })

      expect(action).toHaveProperty("deployGlobalContract")
      expect(action.deployGlobalContract.code).toEqual(specialBytes)
    })

    test("handles mutable contract with account mode", () => {
      const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

      const action = publishContract(code, { identifiedBy: "account" })
      expect(action.deployGlobalContract.deployMode).toEqual({
        AccountId: {},
      })
    })
  })

  describe("deployFromPublished edge cases", () => {
    test("handles code hash with all zeros", () => {
      const zeroHash = new Uint8Array(32).fill(0x00)
      const action = deployFromPublished({ codeHash: zeroHash })

      expect(
        (action.useGlobalContract.contractIdentifier as { CodeHash: number[] })
          .CodeHash,
      ).toEqual(Array.from(zeroHash))
    })

    test("handles code hash with all ones", () => {
      const onesHash = new Uint8Array(32).fill(0xff)
      const action = deployFromPublished({ codeHash: onesHash })

      expect(
        (action.useGlobalContract.contractIdentifier as { CodeHash: number[] })
          .CodeHash,
      ).toEqual(Array.from(onesHash))
    })

    test("handles various base58 encoded hashes", () => {
      const testHashes = [
        new Uint8Array(32).fill(0x00),
        new Uint8Array(32).fill(0xff),
        new Uint8Array(32).fill(0xaa),
        crypto.getRandomValues(new Uint8Array(32)),
      ]

      for (const hashBytes of testHashes) {
        const base58Hash = base58.encode(hashBytes)
        const action = deployFromPublished({ codeHash: base58Hash })

        expect(
          (
            action.useGlobalContract.contractIdentifier as {
              CodeHash: number[]
            }
          ).CodeHash,
        ).toEqual(Array.from(hashBytes))
      }
    })

    test("validates account ID format", () => {
      const validAccountIds = [
        "contract.near",
        "test-account.testnet",
        "a.near",
        "my_contract.near",
      ]

      for (const accountId of validAccountIds) {
        const action = deployFromPublished({ accountId })
        expect(action.useGlobalContract.contractIdentifier).toEqual({
          AccountId: accountId,
        })
      }
    })

    test("throws on hash too short", () => {
      const shortHash = new Uint8Array(31).fill(0xaa)
      expect(() => {
        deployFromPublished({ codeHash: shortHash })
      }).toThrow("Code hash must be 32 bytes, got 31 bytes")
    })

    test("throws on hash too long", () => {
      const longHash = new Uint8Array(33).fill(0xaa)
      expect(() => {
        deployFromPublished({ codeHash: longHash })
      }).toThrow("Code hash must be 32 bytes, got 33 bytes")
    })
  })
})

describe("Global Contracts - Transaction Builder Integration", () => {
  // Helper to create a transaction builder for testing
  function createBuilder(): TransactionBuilder {
    const rpc = new RpcClient("https://rpc.testnet.fastnear.com")
    const keyStore = new InMemoryKeyStore()
    return new TransactionBuilder("alice.near", rpc, keyStore)
  }

  test("publishContract integrates with transaction builder (default account mode)", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const builder = createBuilder().publishContract(code)

    expect(builder).toBeInstanceOf(TransactionBuilder)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deployGlobalContract).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deployGlobalContract.code).toEqual(code)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deployGlobalContract.deployMode).toEqual({
      AccountId: {},
    })
  })

  test("publishContract with hash mode integrates with transaction builder", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const builder = createBuilder().publishContract(code, {
      identifiedBy: "hash",
    })

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deployGlobalContract.deployMode).toEqual({
      CodeHash: {},
    })
  })

  test("deployFromPublished integrates with transaction builder", () => {
    const codeHash = new Uint8Array(32).fill(0xab)
    const builder = createBuilder().deployFromPublished({ codeHash })

    expect(builder).toBeInstanceOf(TransactionBuilder)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].useGlobalContract).toBeDefined()
  })

  test("combines global contract actions with other actions", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const codeHash = new Uint8Array(32).fill(0xab)

    const builder = createBuilder()
      .transfer("bob.near", "1 NEAR")
      .publishContract(code)
      .deployFromPublished({ codeHash })

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(3)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].deployGlobalContract).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[2].useGlobalContract).toBeDefined()
  })

  test("chaining returns same builder instance", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const builder = createBuilder()
    const result1 = builder.publishContract(code)
    const result2 = result1.deployFromPublished({
      accountId: "publisher.near",
    })

    expect(result1).toBe(builder)
    expect(result2).toBe(builder)
  })
})

describe("Global Contracts - Serialization", () => {
  test("publishContract action serializes correctly (default account mode)", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const action = publishContract(code)

    // Should be serializable without errors
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("publishContract with hash mode serializes correctly", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const action = publishContract(code, { identifiedBy: "hash" })

    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("deployFromPublished with codeHash serializes correctly", () => {
    const codeHash = new Uint8Array(32).fill(0xab)
    const action = deployFromPublished({ codeHash })

    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("deployFromPublished with accountId serializes correctly", () => {
    const action = deployFromPublished({ accountId: "publisher.near" })

    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("deployMode enum values are correct", () => {
    const codeHashMode = publishContract(new Uint8Array([0x00]), {
      identifiedBy: "hash",
    })
    const accountIdMode = publishContract(new Uint8Array([0x00]))

    // CodeHash mode should have CodeHash key
    expect(codeHashMode.deployGlobalContract.deployMode).toHaveProperty(
      "CodeHash",
    )
    expect(codeHashMode.deployGlobalContract.deployMode).toEqual({
      CodeHash: {},
    })

    // AccountId mode should have AccountId key (default)
    expect(accountIdMode.deployGlobalContract.deployMode).toHaveProperty(
      "AccountId",
    )
    expect(accountIdMode.deployGlobalContract.deployMode).toEqual({
      AccountId: {},
    })
  })

  test("contractIdentifier enum values are correct", () => {
    const codeHashAction = deployFromPublished({
      codeHash: new Uint8Array(32).fill(0xab),
    })
    const accountIdAction = deployFromPublished({
      accountId: "publisher.near",
    })

    // CodeHash identifier should have CodeHash key with array
    expect(codeHashAction.useGlobalContract.contractIdentifier).toHaveProperty(
      "CodeHash",
    )
    expect(
      Array.isArray(
        (
          codeHashAction.useGlobalContract.contractIdentifier as {
            CodeHash: number[]
          }
        ).CodeHash,
      ),
    ).toBe(true)

    // AccountId identifier should have AccountId key with string
    expect(accountIdAction.useGlobalContract.contractIdentifier).toHaveProperty(
      "AccountId",
    )
    expect(
      typeof (
        accountIdAction.useGlobalContract.contractIdentifier as {
          AccountId: string
        }
      ).AccountId,
    ).toBe("string")
  })

  test("serialization round-trip preserves data", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x02, 0x03])
    const action = publishContract(code)

    const serialized = ActionSchema.serialize(action)
    const deserialized = ActionSchema.deserialize(serialized)

    expect(deserialized).toHaveProperty("deployGlobalContract")
    // Code is returned as Uint8Array after deserialization
    type DeserializedAction = {
      deployGlobalContract: {
        code: Uint8Array
        deployMode: { AccountId: object }
      }
    }
    const typedDeserialized = deserialized as DeserializedAction
    expect(typedDeserialized.deployGlobalContract.code).toEqual(code)
    expect(typedDeserialized.deployGlobalContract.deployMode).toEqual({
      AccountId: {},
    })
  })
})
