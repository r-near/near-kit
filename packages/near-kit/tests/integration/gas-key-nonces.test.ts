/**
 * Integration test for the `view_gas_key_nonces` reader (NEAR 2.13).
 *
 * End-to-end: create an account, add a gas full-access key with N parallel
 * nonce lanes, fund it, then read the lanes back with
 * `RpcClient.getGasKeyNonces` and assert we get exactly N sane per-lane nonces
 * plus the block context. Also asserts that reading a non-gas key rejects.
 *
 * Sandbox version overridable via NEAR_SANDBOX_VERSION; defaults to a 2.13 RC.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { AccessKeyDoesNotExistError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

const SANDBOX_VERSION = process.env.NEAR_SANDBOX_VERSION ?? "2.13.0-rc.2"

describe("view_gas_key_nonces reader - Integration Test (NEAR 2.13)", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start({ version: SANDBOX_VERSION })
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })
    console.log(
      `✓ Sandbox ${SANDBOX_VERSION} started: ${sandbox.rootAccount.id}`,
    )
  }, 180000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  test("reads N per-lane nonces from a funded gas key", async () => {
    const accountId = `gknonces-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const gasKey = generateKey()
    const NUM_NONCES = 3

    // Create the gas-key owner with a normal full-access key.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    const ownerNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    // Add a gas full-access key with NUM_NONCES parallel lanes and fund it.
    await ownerNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFullAccess",
        numNonces: NUM_NONCES,
      })
      .transferToGasKey(gasKey.publicKey.toString(), "5 NEAR")
      .send()

    // Read the lanes back through the new typed reader.
    const response = await near.rpc.getGasKeyNonces(
      accountId,
      gasKey.publicKey.toString(),
    )

    expect(response.nonces).toHaveLength(NUM_NONCES)
    for (const nonce of response.nonces) {
      expect(Number.isInteger(nonce)).toBe(true)
      expect(nonce).toBeGreaterThanOrEqual(0)
    }
    expect(response.block_height).toBeGreaterThan(0)
    expect(typeof response.block_hash).toBe("string")
    expect(response.block_hash.length).toBeGreaterThan(0)
    console.log(
      `✓ Read ${response.nonces.length} gas-key nonce lanes: [${response.nonces.join(", ")}]`,
    )
  }, 60000)

  test("rejects when the public key is not a gas key", async () => {
    const accountId = `gknorm-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()

    // A plain account whose full-access key is NOT a gas key.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "1 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    await expect(
      near.rpc.getGasKeyNonces(accountId, accountKey.publicKey.toString()),
    ).rejects.toBeInstanceOf(AccessKeyDoesNotExistError)
  }, 60000)
})
