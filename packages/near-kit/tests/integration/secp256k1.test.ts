/**
 * Integration tests for secp256k1 keys: the node must accept transactions and
 * delegate actions signed by a secp256k1 full-access key.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { decodeSignedDelegateAction } from "../../src/core/schema.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { Secp256k1KeyPair } from "../../src/utils/key.js"

describe("secp256k1 - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let secpKey: Secp256k1KeyPair
  let accountId: string
  let recipientId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })

    secpKey = Secp256k1KeyPair.fromRandom()
    accountId = `secp-${Date.now()}.${sandbox.rootAccount.id}`
    recipientId = `secp-recv-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(secpKey.publicKey.toString(), { type: "fullAccess" })
      .send()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "1 NEAR")
      .send()
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("signs a transfer that the node accepts", async () => {
    const nearSecp = new Near({
      network: sandbox,
      keyStore: { [accountId]: secpKey.secretKey },
    })

    const before = Number.parseFloat(await near.getBalance(recipientId))
    await nearSecp.transaction(accountId).transfer(recipientId, "2 NEAR").send()
    const after = Number.parseFloat(await near.getBalance(recipientId))

    expect(after).toBeGreaterThan(before + 1.5)
  }, 60000)

  test("signs a delegate action that a relayer can submit", async () => {
    const nearSecp = new Near({
      network: sandbox,
      keyStore: { [accountId]: secpKey.secretKey },
    })

    const { payload } = await nearSecp
      .transaction(accountId)
      .transfer(recipientId, "1 NEAR")
      .delegate({ blockHeightOffset: 100 })

    const before = Number.parseFloat(await near.getBalance(recipientId))
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .signedDelegateAction(decodeSignedDelegateAction(payload))
      .send({ waitUntil: "EXECUTED" })
    expect("Failure" in (result.status as object)).toBe(false)
    const after = Number.parseFloat(await near.getBalance(recipientId))

    expect(after).toBeGreaterThan(before + 0.5)
  }, 60000)
})
