/**
 * Tests for Near client configuration
 */

import { describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import { NearConfigSchema, resolveNetworkConfig } from "../../src/core/config-schemas.js"

describe("Network Configuration", () => {
  test("should use mainnet by default", () => {
    const config = resolveNetworkConfig()

    expect(config.networkId).toBe("mainnet")
    expect(config.rpcUrl).toBe("https://free.rpc.fastnear.com")
  })

  test("should accept mainnet preset", () => {
    const config = resolveNetworkConfig("mainnet")

    expect(config.networkId).toBe("mainnet")
    expect(config.rpcUrl).toBe("https://free.rpc.fastnear.com")
    expect(config.walletUrl).toBe("https://wallet.near.org")
  })

  test("should accept testnet preset", () => {
    const config = resolveNetworkConfig("testnet")

    expect(config.networkId).toBe("testnet")
    expect(config.rpcUrl).toBe("https://rpc.testnet.fastnear.com")
    expect(config.walletUrl).toBe("https://wallet.testnet.near.org")
  })

  test("should accept localnet preset", () => {
    const config = resolveNetworkConfig("localnet")

    expect(config.networkId).toBe("localnet")
    expect(config.rpcUrl).toBe("http://localhost:3030")
    expect(config.walletUrl).toBe("http://localhost:1234")
  })

  test("should accept custom network config", () => {
    const config = resolveNetworkConfig({
      rpcUrl: "https://custom-rpc.example.com",
      networkId: "custom-network",
    })

    expect(config.networkId).toBe("custom-network")
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com")
  })

  test("should accept custom network with optional fields", () => {
    const config = resolveNetworkConfig({
      rpcUrl: "https://custom-rpc.example.com",
      networkId: "custom-network",
      walletUrl: "https://custom-wallet.example.com",
      helperUrl: "https://custom-helper.example.com",
    })

    expect(config.networkId).toBe("custom-network")
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com")
    expect(config.walletUrl).toBe("https://custom-wallet.example.com")
    expect(config.helperUrl).toBe("https://custom-helper.example.com")
  })

  test("should reject invalid network preset", () => {
    expect(() => {
      resolveNetworkConfig("invalid" as any)
    }).toThrow()
  })

  test("should reject custom network with invalid RPC URL", () => {
    expect(() => {
      resolveNetworkConfig({
        rpcUrl: "not-a-url",
        networkId: "custom",
      })
    }).toThrow()
  })

  test("should reject custom network without networkId", () => {
    expect(() => {
      resolveNetworkConfig({
        rpcUrl: "https://custom-rpc.example.com",
        networkId: "",
      })
    }).toThrow()
  })
})

describe("Near Config Schema", () => {
  test("should accept empty config", () => {
    const config = NearConfigSchema.parse({})

    expect(config).toEqual({})
  })

  test("should accept config with network preset", () => {
    const config = NearConfigSchema.parse({
      network: "testnet",
    })

    expect(config.network).toBe("testnet")
  })

  test("should accept config with custom network", () => {
    const config = NearConfigSchema.parse({
      network: {
        rpcUrl: "https://custom.example.com",
        networkId: "custom",
      },
    })

    expect(config.network).toEqual({
      rpcUrl: "https://custom.example.com",
      networkId: "custom",
    })
  })

  test("should accept config with rpcUrl override", () => {
    const config = NearConfigSchema.parse({
      network: "mainnet",
      rpcUrl: "https://custom-mainnet.example.com",
    })

    expect(config.network).toBe("mainnet")
    expect(config.rpcUrl).toBe("https://custom-mainnet.example.com")
  })

  test("should accept config with headers", () => {
    const config = NearConfigSchema.parse({
      headers: {
        "X-API-Key": "test-key",
        Authorization: "Bearer token",
      },
    })

    expect(config.headers).toEqual({
      "X-API-Key": "test-key",
      Authorization: "Bearer token",
    })
  })

  test("should accept config with autoGas", () => {
    const configTrue = NearConfigSchema.parse({ autoGas: true })
    const configFalse = NearConfigSchema.parse({ autoGas: false })

    expect(configTrue.autoGas).toBe(true)
    expect(configFalse.autoGas).toBe(false)
  })

  test("should accept config with keyStore as string", () => {
    const config = NearConfigSchema.parse({
      keyStore: "~/.near-credentials",
    })

    expect(config.keyStore).toBe("~/.near-credentials")
  })

  test("should accept config with keyStore as record", () => {
    const config = NearConfigSchema.parse({
      keyStore: {
        "alice.near": "ed25519:...",
        "bob.near": "ed25519:...",
      },
    })

    expect(config.keyStore).toEqual({
      "alice.near": "ed25519:...",
      "bob.near": "ed25519:...",
    })
  })

  test("should accept config with privateKey as string", () => {
    const config = NearConfigSchema.parse({
      privateKey: "ed25519:abc123...",
    })

    expect(config.privateKey).toBe("ed25519:abc123...")
  })

  test("should reject invalid RPC URL", () => {
    expect(() => {
      NearConfigSchema.parse({
        rpcUrl: "not-a-url",
      })
    }).toThrow()
  })
})

describe("Near Constructor", () => {
  test("should create instance with no config", () => {
    const near = new Near()

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with mainnet config", () => {
    const near = new Near({ network: "mainnet" })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with testnet config", () => {
    const near = new Near({ network: "testnet" })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with localnet config", () => {
    const near = new Near({ network: "localnet" })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with custom network", () => {
    const near = new Near({
      network: {
        rpcUrl: "https://custom.example.com",
        networkId: "custom",
      },
    })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with RPC URL override", () => {
    const near = new Near({
      network: "mainnet",
      rpcUrl: "https://custom-mainnet.example.com",
    })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with headers", () => {
    const near = new Near({
      headers: {
        "X-API-Key": "test-key",
      },
    })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with autoGas disabled", () => {
    const near = new Near({
      autoGas: false,
    })

    expect(near).toBeInstanceOf(Near)
  })

  test("should create instance with in-memory keystore", () => {
    const near = new Near({
      keyStore: {
        "alice.near": "ed25519:test123",
      },
    })

    expect(near).toBeInstanceOf(Near)
  })

  test("should throw on invalid network", () => {
    expect(() => {
      new Near({
        network: "invalid" as any,
      })
    }).toThrow()
  })

  test("should throw on invalid RPC URL", () => {
    expect(() => {
      new Near({
        rpcUrl: "not-a-url",
      })
    }).toThrow()
  })

  test("should throw on invalid custom network", () => {
    expect(() => {
      new Near({
        network: {
          rpcUrl: "not-a-url",
          networkId: "custom",
        },
      })
    }).toThrow()
  })
})

describe("Config Validation Edge Cases", () => {
  test("should handle undefined network gracefully", () => {
    const config = NearConfigSchema.parse({
      network: undefined,
    })

    expect(config.network).toBeUndefined()
  })

  test("should handle multiple config options", () => {
    const config = NearConfigSchema.parse({
      network: "testnet",
      rpcUrl: "https://custom.example.com",
      headers: { "X-Test": "value" },
      autoGas: false,
    })

    expect(config.network).toBe("testnet")
    expect(config.rpcUrl).toBe("https://custom.example.com")
    expect(config.headers).toEqual({ "X-Test": "value" })
    expect(config.autoGas).toBe(false)
  })

  test("should preserve unknown fields in keyStore object", () => {
    const config = NearConfigSchema.parse({
      keyStore: {
        "account1.near": "key1",
        "account2.near": "key2",
        "account3.near": "key3",
      },
    })

    expect(Object.keys(config.keyStore as any)).toHaveLength(3)
  })
})
