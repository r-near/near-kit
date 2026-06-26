/**
 * Integration tests for gas-key actions and permissions (protocol v85 / NEAR 2.13).
 *
 * Proves the borsh wire format AND the RPC view schemas are correct by having a
 * real 2.13 node execute the new actions and parsing the (status-bearing)
 * default `.send()` response, which echoes the gas-key actions back:
 * - AddKey with a GasKeyFullAccess / GasKeyFunctionCall permission
 * - TransferToGasKey (fund the gas key) and WithdrawFromGasKey
 *
 * The default EXECUTED_OPTIMISTIC wait parses the response through
 * FinalExecutionOutcomeSchema; this confirms the gas-key action/permission view
 * schemas added in this PR parse a successful 2.13 response (the default public
 * API path) rather than throwing.
 *
 * The sandbox version is pinned to a 2.13 release explicitly so this test does
 * not depend on the default-version bump landing first.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

// Newest published 2.13 sandbox binary (stable 2.13.0 not yet released).
// Overridable via NEAR_SANDBOX_VERSION so CI can move off a renamed/GC'd RC or
// to a stable 2.13.0 without a code change.
const SANDBOX_VERSION = process.env.NEAR_SANDBOX_VERSION ?? "2.13.0-rc.2"

describe("Gas Key Actions - Integration Tests (NEAR 2.13)", () => {
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

  test("adds a gas full-access key and funds it via TransferToGasKey", async () => {
    const accountId = `gaskey-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const gasKey = generateKey()

    // Create the account with a normal full-access key.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    const accountNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    // Add a gas key (full access, 4 parallel nonces) then fund it. Default
    // (status-bearing) send: the response echoes both gas-key actions, so this
    // also exercises the gas-key permission/action view schemas.
    const result = await accountNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFullAccess",
        numNonces: 4,
      })
      .transferToGasKey(gasKey.publicKey.toString(), "2 NEAR")
      .send()

    expect("Failure" in (result.status as object)).toBe(false)
    expect("SuccessValue" in (result.status as object)).toBe(true)
    console.log(`✓ Added + funded gas full-access key on ${accountId}`)
  }, 60000)

  test("adds a gas function-call key restricted to a contract", async () => {
    const accountId = `gaskeyfc-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const gasKey = generateKey()

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    const accountNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    const result = await accountNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFunctionCall",
        numNonces: 2,
        receiverId: "contract.near",
        methodNames: ["do_thing"],
      })
      .send()

    expect("Failure" in (result.status as object)).toBe(false)
    expect("SuccessValue" in (result.status as object)).toBe(true)
    console.log(`✓ Added gas function-call key on ${accountId}`)
  }, 60000)

  test("executes add + fund + withdraw gas key actions atomically", async () => {
    const accountId = `gaskeyw-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const gasKey = generateKey()

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    const accountNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    // Add the gas key, fund it, then withdraw from it — all in one atomic
    // transaction so the actions execute in order without cross-tx races. This
    // exercises the borsh encoding of all three gas-key actions plus parsing
    // their view representations in the (status-bearing) response.
    const result = await accountNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFullAccess",
        numNonces: 1,
      })
      .transferToGasKey(gasKey.publicKey.toString(), "2 NEAR")
      .withdrawFromGasKey(gasKey.publicKey.toString(), "1 NEAR")
      .send()

    expect("Failure" in (result.status as object)).toBe(false)
    expect("SuccessValue" in (result.status as object)).toBe(true)
    console.log(
      `✓ Executed add + fund + withdraw gas key actions on ${accountId}`,
    )
  }, 60000)
})
