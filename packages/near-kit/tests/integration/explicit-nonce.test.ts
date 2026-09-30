/**
 * Integration test for TransactionBuilder.nonce(): transactions signed at a
 * caller-chosen nonce are accepted by a real node, both for an ordinary access
 * key (V0) and for a gas-key nonce slot (V1 GasKeyNonce), and a reused nonce is
 * surfaced as InvalidNonceError instead of being silently re-signed.
 *
 * Sandbox version overridable via NEAR_SANDBOX_VERSION.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { InvalidNonceError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"

const SANDBOX_VERSION = process.env["NEAR_SANDBOX_VERSION"] ?? "2.13.0-rc.2"

describe("Explicit nonce - Integration Test", () => {
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
  }, 180000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  async function createFundedAccount(prefix: string) {
    const accountId = `${prefix}-${Date.now()}.${sandbox.rootAccount.id}`
    const key = generateKey()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "20 NEAR")
      .addKey(key.publicKey.toString(), { type: "fullAccess" })
      .send()
    const accountNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: key.secretKey },
    })
    return { accountId, key, accountNear }
  }

  test("an ordinary key signs at the given nonce, and a reused nonce is rejected without retry", async () => {
    const { accountId, key, accountNear } = await createFundedAccount("xn")

    const accessKey = await near.getAccessKey(
      accountId,
      key.publicKey.toString(),
    )
    // Skip ahead: any nonce above the access-key nonce is valid (monotonic).
    const chosen = BigInt(accessKey?.nonce ?? 0) + 5n

    const result = await accountNear
      .transaction(accountId)
      .nonce(chosen)
      .transfer(sandbox.rootAccount.id, "1 NEAR")
      .send({ waitUntil: "FINAL" })
    expect("SuccessValue" in (result.status as object)).toBe(true)

    const after = await near.getAccessKey(accountId, key.publicKey.toString())
    expect(BigInt(after?.nonce ?? 0)).toBe(chosen)

    // Reusing the same nonce is refused by the node and surfaced as-is.
    await expect(
      accountNear
        .transaction(accountId)
        .nonce(chosen)
        .transfer(sandbox.rootAccount.id, "1 NEAR")
        .send(),
    ).rejects.toBeInstanceOf(InvalidNonceError)
  }, 120000)

  test("a gas-key slot signs at the given nonce", async () => {
    const { accountId, accountNear } = await createFundedAccount("xng")
    const gasKey = generateKey()

    await accountNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFullAccess",
        numNonces: 2,
      })
      .transferToGasKey(gasKey.publicKey.toString(), "5 NEAR")
      .send()

    const slotNonces = await near.rpc.getGasKeyNonces(
      accountId,
      gasKey.publicKey.toString(),
    )
    const chosen = BigInt(slotNonces.nonces[1] ?? 0) + 3n

    const result = await accountNear
      .transaction(accountId)
      .signWith(gasKey.secretKey as PrivateKey)
      .useGasKey(1)
      .nonce(chosen)
      .transfer(sandbox.rootAccount.id, "1 NEAR")
      .send({ waitUntil: "FINAL" })
    expect("SuccessValue" in (result.status as object)).toBe(true)

    const afterNonces = await near.rpc.getGasKeyNonces(
      accountId,
      gasKey.publicKey.toString(),
    )
    expect(BigInt(afterNonces.nonces[1] ?? 0)).toBe(chosen)
  }, 120000)
})
