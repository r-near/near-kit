/**
 * Tests for credential file schemas
 */

import { describe, expect, test } from "bun:test"
import {
  LegacyCredentialSchema,
  NearCliCredentialSchema,
  NetworkSchema,
  parseCredentialFile,
} from "../../src/keys/credential-schemas.js"

describe("NearCliCredentialSchema", () => {
  test("should parse valid credential file", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      private_key: "ed25519:3D4c2v8K5x...",
    }

    const result = NearCliCredentialSchema.parse(credential)

    expect(result.account_id).toBe("example.testnet")
    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.private_key).toBe("ed25519:3D4c2v8K5x...")
  })

  test("should parse credential with optional fields", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      private_key: "ed25519:3D4c2v8K5x...",
      seed_phrase_hd_path: "m/44'/397'/0'",
      master_seed_phrase: "word1 word2 word3 ...",
      implicit_account_id: "1234567890abcdef...",
    }

    const result = NearCliCredentialSchema.parse(credential)

    expect(result.seed_phrase_hd_path).toBe("m/44'/397'/0'")
    expect(result.master_seed_phrase).toBe("word1 word2 word3 ...")
    expect(result.implicit_account_id).toBe("1234567890abcdef...")
  })

  test("should parse credential without account_id", () => {
    const credential = {
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      private_key: "ed25519:3D4c2v8K5x...",
    }

    const result = NearCliCredentialSchema.parse(credential)

    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.private_key).toBe("ed25519:3D4c2v8K5x...")
    expect(result.account_id).toBeUndefined()
  })

  test("should fail on missing public_key", () => {
    const credential = {
      account_id: "example.testnet",
      private_key: "ed25519:3D4c2v8K5x...",
    }

    expect(() => NearCliCredentialSchema.parse(credential)).toThrow()
  })

  test("should fail on missing private_key", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    }

    expect(() => NearCliCredentialSchema.parse(credential)).toThrow()
  })
})

describe("LegacyCredentialSchema", () => {
  test("should parse legacy format with secret_key", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      secret_key: "ed25519:3D4c2v8K5x...",
    }

    const result = LegacyCredentialSchema.parse(credential)

    expect(result.account_id).toBe("example.testnet")
    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.secret_key).toBe("ed25519:3D4c2v8K5x...")
  })

  test("should parse legacy format with optional fields", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      secret_key: "ed25519:3D4c2v8K5x...",
      seed_phrase_hd_path: "m/44'/397'/0'",
      master_seed_phrase: "word1 word2 word3 ...",
    }

    const result = LegacyCredentialSchema.parse(credential)

    expect(result.seed_phrase_hd_path).toBe("m/44'/397'/0'")
    expect(result.master_seed_phrase).toBe("word1 word2 word3 ...")
  })

  test("should fail on missing secret_key", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    }

    expect(() => LegacyCredentialSchema.parse(credential)).toThrow()
  })
})

describe("parseCredentialFile", () => {
  test("should parse modern format with private_key", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      private_key: "ed25519:3D4c2v8K5x...",
    }

    const result = parseCredentialFile(credential)

    expect(result.account_id).toBe("example.testnet")
    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.private_key).toBe("ed25519:3D4c2v8K5x...")
  })

  test("should parse legacy format and convert secret_key to private_key", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      secret_key: "ed25519:3D4c2v8K5x...",
    }

    const result = parseCredentialFile(credential)

    expect(result.account_id).toBe("example.testnet")
    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.private_key).toBe("ed25519:3D4c2v8K5x...")
    expect("secret_key" in result).toBe(false)
  })

  test("should parse legacy format with all fields", () => {
    const credential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      secret_key: "ed25519:3D4c2v8K5x...",
      seed_phrase_hd_path: "m/44'/397'/0'",
      master_seed_phrase: "word1 word2 word3 ...",
      implicit_account_id: "1234567890abcdef...",
    }

    const result = parseCredentialFile(credential)

    expect(result.account_id).toBe("example.testnet")
    expect(result.public_key).toBe(
      "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    )
    expect(result.private_key).toBe("ed25519:3D4c2v8K5x...")
    expect(result.seed_phrase_hd_path).toBe("m/44'/397'/0'")
    expect(result.master_seed_phrase).toBe("word1 word2 word3 ...")
    expect(result.implicit_account_id).toBe("1234567890abcdef...")
    expect("secret_key" in result).toBe(false)
  })

  test("should accept both modern and legacy formats", () => {
    const modernCredential = {
      public_key: "ed25519:modern",
      private_key: "ed25519:modern-key",
    }

    const legacyCredential = {
      public_key: "ed25519:legacy",
      secret_key: "ed25519:legacy-key",
    }

    const modernResult = parseCredentialFile(modernCredential)
    const legacyResult = parseCredentialFile(legacyCredential)

    expect(modernResult.private_key).toBe("ed25519:modern-key")
    expect(legacyResult.private_key).toBe("ed25519:legacy-key")
  })

  test("should throw on invalid format", () => {
    const invalidCredential = {
      account_id: "example.testnet",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      // Missing both private_key and secret_key
    }

    expect(() => parseCredentialFile(invalidCredential)).toThrow()
  })

  test("should throw on completely invalid data", () => {
    const invalidCredential = {
      random_field: "value",
    }

    expect(() => parseCredentialFile(invalidCredential)).toThrow()
  })
})

describe("NetworkSchema", () => {
  test("should accept valid network identifiers", () => {
    expect(NetworkSchema.parse("mainnet")).toBe("mainnet")
    expect(NetworkSchema.parse("testnet")).toBe("testnet")
    expect(NetworkSchema.parse("betanet")).toBe("betanet")
    expect(NetworkSchema.parse("localnet")).toBe("localnet")
  })

  test("should reject invalid network identifiers", () => {
    expect(() => NetworkSchema.parse("invalid")).toThrow()
    expect(() => NetworkSchema.parse("customnet")).toThrow()
    expect(() => NetworkSchema.parse("")).toThrow()
  })
})
