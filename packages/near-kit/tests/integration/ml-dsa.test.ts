/**
 * Integration tests for ML-DSA-65 (FIPS 204) post-quantum keys.
 *
 * The definitive correctness proof: an account whose only full-access key is an
 * ML-DSA-65 key signs a transfer that a 2.13 node accepts on-chain. This proves
 * the @noble/post-quantum seed -> keypair derivation and signature format are
 * wire-compatible with nearcore's aws-lc-rs FIPS-204 verifier.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { KeyType } from "../../src/core/types.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import {
  generateKey,
  MlDsa65KeyPair,
  parsePublicKey,
} from "../../src/utils/key.js"

// ML-DSA-65 (ProtocolFeature::PostQuantumSignatures) is gated at protocol v85.
// A pre-85 node rejects key type 2 with "unknown key type '2'", so this test
// pins the sandbox to a version whose binary runs proto 85 WITH the PQ impl,
// rather than relying on the (separately bumped) default version. Verified: the
// S3 binary near-sandbox-2.13.0-rc.2 (git tag commit 315524124) genuinely has
// ML-DSA. TODO: re-pin to a stable 2.13.x once one ships with PQ.
const ML_DSA_SANDBOX_VERSION = "2.13.0-rc.2"
const POST_QUANTUM_PROTOCOL_VERSION = 85

describe("ML-DSA-65 - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let protocolVersion = 0

  beforeAll(async () => {
    sandbox = await Sandbox.start({ version: ML_DSA_SANDBOX_VERSION })
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })
    protocolVersion = (await near.getStatus()).protocol_version
    console.log(
      `✓ Sandbox started: ${sandbox.rootAccount.id} (protocol ${protocolVersion})`,
    )
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("adds an ML-DSA-65 key and signs an on-chain transfer with it", async (ctx) => {
    if (protocolVersion < POST_QUANTUM_PROTOCOL_VERSION) {
      console.warn(
        `⚠ Skipping on-chain ML-DSA-65 test: node is protocol ${protocolVersion}, ` +
          `PostQuantumSignatures needs ${POST_QUANTUM_PROTOCOL_VERSION}+ (2.13.x sandbox)`,
      )
      ctx.skip()
      return
    }

    const mlKey = MlDsa65KeyPair.fromRandom()
    expect(mlKey.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(mlKey.publicKey.data.length).toBe(1952)
    expect(mlKey.publicKey.toString().startsWith("ml-dsa-65:")).toBe(true)

    const accountId = `ml-dsa-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account with the ML-DSA key as its only full-access key.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(mlKey.publicKey.toString(), { type: "fullAccess" })
      .send()
    console.log(`✓ Created ${accountId} with ML-DSA-65 full-access key`)

    // Sign a transfer FROM the ML-DSA account; the node verifies the PQ signature.
    const beneficiary = `ml-dsa-recv-${Date.now()}.${sandbox.rootAccount.id}`
    const beneficiaryKey = generateKey()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(beneficiary)
      .transfer(beneficiary, "1 NEAR")
      .addKey(beneficiaryKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    const nearMl = new Near({
      network: sandbox,
      keyStore: { [accountId]: mlKey.secretKey },
    })

    const balanceBefore = Number.parseFloat(await near.getBalance(beneficiary))
    await nearMl.transaction(accountId).transfer(beneficiary, "2 NEAR").send()
    const balanceAfter = Number.parseFloat(await near.getBalance(beneficiary))

    expect(balanceAfter).toBeGreaterThan(balanceBefore)
    console.log(
      `✓ ML-DSA-65-signed transfer accepted on-chain: ${balanceBefore} → ${balanceAfter} NEAR`,
    )
  }, 60000)

  test("seed round-trips: parsed key produces identical public key", () => {
    const original = MlDsa65KeyPair.fromRandom()
    const restored = parsePublicKey(original.publicKey.toString())
    expect(restored.keyType).toBe(KeyType.ML_DSA_65)
    expect(Array.from(restored.data)).toEqual(
      Array.from(original.publicKey.data),
    )
  })
})
