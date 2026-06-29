/**
 * Integration test for DelegateV2 meta-transactions (NEAR 2.13).
 *
 * End-to-end relay: a sender signs a `DelegateActionV2` (under the V2 NEP-461
 * domain tag); a separate relayer wraps it in `Action::DelegateV2` and submits
 * it, and a real 2.13 node accepts and EXECUTES the inner transfer. This proves
 * the V2 wire format and the V2 signing domain tag on-chain.
 *
 * The default (status-bearing) send asserts execution success and exercises the
 * DelegateV2 RPC action view; the recipient balance delta confirms the inner
 * transfer moved funds.
 *
 * Sandbox version overridable via NEAR_SANDBOX_VERSION; defaults to a 2.13 RC.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

const SANDBOX_VERSION = process.env.NEAR_SANDBOX_VERSION ?? "2.13.0-rc.2"

describe("DelegateV2 - Integration Test (NEAR 2.13)", () => {
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

  test("relays a V2 signed delegate action on-chain", async () => {
    const senderId = `dv2-sender-${Date.now()}.${sandbox.rootAccount.id}`
    const senderKey = generateKey()
    const recipientId = `dv2-recv-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the sender (with its own full-access key) and the recipient.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(senderId)
      .transfer(senderId, "10 NEAR")
      .addKey(senderKey.publicKey.toString(), { type: "fullAccess" })
      .send()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "1 NEAR")
      .send()

    const senderNear = new Near({
      network: sandbox,
      keyStore: { [senderId]: senderKey.secretKey },
    })

    // The sender signs a V2 delegate action (ordinary nonce, not a gas key):
    // "transfer 1 NEAR from me to the recipient".
    const { signedDelegateAction } = await senderNear
      .transaction(senderId)
      .transfer(recipientId, "1 NEAR")
      .delegateV2({ payloadFormat: "bytes" })

    const balanceBefore = Number.parseFloat(await near.getBalance(recipientId))

    // The relayer (root) wraps the V2 signed delegate and submits it. Default
    // (status-bearing) send: the response echoes the DelegateV2 action, so this
    // also exercises the DelegateV2 RPC action view.
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .signedDelegateActionV2(signedDelegateAction)
      .send()
    expect("Failure" in (result.status as object)).toBe(false)
    expect("SuccessValue" in (result.status as object)).toBe(true)

    // And the inner transfer actually moved funds.
    const balanceAfter = Number.parseFloat(await near.getBalance(recipientId))
    expect(balanceAfter).toBeGreaterThan(balanceBefore + 0.5)
    console.log(`✓ DelegateV2 relayed and executed: ${recipientId} funded`)
  }, 120000)
})
