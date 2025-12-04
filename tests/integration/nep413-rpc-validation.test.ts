/**
 * Integration tests for NEP-413 RPC validation
 *
 * These tests verify that the verifyNep413Signature function correctly
 * validates that a public key belongs to the claimed account ID via RPC.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import type { SignMessageParams } from "../../src/core/types.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { Sandbox } from "../../src/sandbox/index.js"
import { Ed25519KeyPair, generateNonce } from "../../src/utils/index.js"
import { verifyNep413Signature } from "../../src/utils/nep413.js"

let sandbox: Sandbox
let near: Near
let keyStore: InMemoryKeyStore

beforeAll(async () => {
  sandbox = await Sandbox.start({ detached: false })
  keyStore = new InMemoryKeyStore()
  near = new Near({
    network: sandbox,
    keyStore,
  })
  console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
}, 120000)

afterAll(async () => {
  if (sandbox) {
    await sandbox.stop()
    console.log("✓ Sandbox stopped")
  }
})

describe("NEP-413 RPC Validation - Integration Tests", () => {
  test("should verify signature when key exists for account", async () => {
    // Create a test account with a known key
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = `nep413-test-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account with the key
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .addKey(keyPair.publicKey.toString(), { type: "fullAccess" })
      .transfer(accountId, "1 NEAR")
      .send()

    // Sign a message with the key
    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Verify the signature with RPC validation using the sandbox RPC URL
    const isValid = await verifyNep413Signature(signedMessage, params, {
      rpc: sandbox.rpcUrl,
    })

    expect(isValid).toBe(true)
  }, 60000)

  test("should fail verification when key does not exist for account", async () => {
    // Create a test account with a different key than what we'll sign with
    const accountKey = Ed25519KeyPair.fromRandom()
    const signingKey = Ed25519KeyPair.fromRandom() // Different key!
    const accountId = `nep413-test-wrong-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account with accountKey
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .transfer(accountId, "1 NEAR")
      .send()

    // Sign a message with a DIFFERENT key (signingKey)
    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Sign with signingKey but claim it's from accountId
    const signedMessage = signingKey.signNep413Message(accountId, params)

    // Verify the signature with RPC validation - should fail because
    // signingKey's public key does not belong to accountId
    const isValid = await verifyNep413Signature(signedMessage, params, {
      rpc: sandbox.rpcUrl,
    })

    expect(isValid).toBe(false)
  }, 60000)

  test("should fail verification when account does not exist", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonExistentAccountId = `non-existent-${Date.now()}.near`

    // Sign a message claiming to be from a non-existent account
    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(
      nonExistentAccountId,
      params,
    )

    // Verify the signature with RPC validation - should fail because
    // the account doesn't exist
    const isValid = await verifyNep413Signature(signedMessage, params, {
      rpc: sandbox.rpcUrl,
    })

    expect(isValid).toBe(false)
  }, 60000)

  test("should work with RpcClient instance instead of URL string", async () => {
    // Create a test account with a known key
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = `nep413-rpc-client-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account with the key
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .addKey(keyPair.publicKey.toString(), { type: "fullAccess" })
      .transfer(accountId, "1 NEAR")
      .send()

    // Sign a message with the key
    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create an RpcClient instance
    const rpcClient = new RpcClient(sandbox.rpcUrl)

    // Verify the signature with RPC validation using the RpcClient instance
    const isValid = await verifyNep413Signature(signedMessage, params, {
      rpc: rpcClient,
    })

    expect(isValid).toBe(true)
  }, 60000)

  test("should pass verification without RPC when rpc option is not provided", async () => {
    // This test ensures backward compatibility - when no RPC is provided,
    // only cryptographic verification is performed
    const keyPair = Ed25519KeyPair.fromRandom()
    const fakeAccountId = "fake-account.near" // Account doesn't exist

    // Sign a message
    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(fakeAccountId, params)

    // Without RPC option, verification should pass (only cryptographic check)
    const isValid = await verifyNep413Signature(signedMessage, params)

    expect(isValid).toBe(true)
  })
})
