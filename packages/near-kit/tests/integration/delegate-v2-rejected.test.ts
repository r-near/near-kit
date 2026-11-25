/**
 * nearcore rejects `Action::DelegateV2` from protocol 87 (2.14). On the default
 * sandbox, relaying a V2 signed delegate fails with RemovedProtocolFeatureError
 * while the same transfer relayed as a V1 delegate still executes.
 *
 * delegate-v2.test.ts covers the V2 relay on a 2.13 node, which still accepts it.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import {
  InvalidTransactionError,
  RemovedProtocolFeatureError,
} from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("DelegateV2 on a node that removed it", () => {
  let sandbox: Sandbox
  let near: Near
  let senderNear: Near
  let senderId: string
  let recipientId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
    })
    const senderKey = generateKey()
    senderId = `dv2r-sender-${Date.now()}.${sandbox.rootAccount.id}`
    recipientId = `dv2r-recv-${Date.now()}.${sandbox.rootAccount.id}`
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
    senderNear = new Near({
      network: sandbox,
      keyStore: { [senderId]: senderKey.secretKey },
    })
  }, 180000)

  afterAll(async () => {
    await sandbox?.stop()
  })

  test("a relayed V2 delegate is rejected with RemovedProtocolFeatureError", async () => {
    const { signedDelegateAction } = await senderNear
      .transaction(senderId)
      .transfer(recipientId, "1 NEAR")
      .delegateV2()

    const error = await near
      .transaction(sandbox.rootAccount.id)
      .signedDelegateActionV2(signedDelegateAction)
      .send()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RemovedProtocolFeatureError)
    expect(error).toBeInstanceOf(InvalidTransactionError)
    const removed = error as RemovedProtocolFeatureError
    expect(removed.protocolFeature).toBe("DelegateV2")
    expect(removed.protocolVersion).toBeGreaterThanOrEqual(87)
  }, 120000)

  test("the same transfer relayed as a V1 delegate executes", async () => {
    const { signedDelegateAction } = await senderNear
      .transaction(senderId)
      .transfer(recipientId, "1 NEAR")
      .delegate()

    const before = Number.parseFloat(await near.getBalance(recipientId))
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .signedDelegateAction(signedDelegateAction)
      .send()
    expect(result.status).toHaveProperty("SuccessValue")
    const after = Number.parseFloat(await near.getBalance(recipientId))
    expect(after).toBeGreaterThan(before + 0.5)
  }, 120000)
})
