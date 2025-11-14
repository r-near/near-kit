import { describe, expect, test } from "bun:test"
import { base58 } from "@scure/base"
import { deployFromPublished, publishContract } from "../../src/core/actions.js"

describe("Global Contracts API", () => {
  test("publishContract creates immutable contract action", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d]) // WASM header
    const action = publishContract(code)

    expect(action).toHaveProperty("deployGlobalContract")
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ CodeHash: {} })
  })

  test("publishContract creates mutable contract action", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const accountId = "my-publisher.near"
    const action = publishContract(code, accountId)

    expect(action).toHaveProperty("deployGlobalContract")
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ AccountId: {} })
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
