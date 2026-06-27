/**
 * Integration test for the gas-key signing path (TransactionV1, NEAR 2.13).
 *
 * End-to-end: create an account, add a gas full-access key with several nonce
 * slots, fund it, then SIGN A TRANSFER WITH THE GAS KEY and have a real 2.13
 * node accept and execute it. This is the definitive proof of the V1 wire
 * format (the `[0x01]`-tagged transaction carrying a `GasKeyNonce`) plus the
 * gas-key signing path.
 *
 * Both the setup (add + fund) and the gas-key-signed transfer use the default
 * status-bearing send and assert real execution success; the gas-key action /
 * permission RPC views (in #196) parse the echoed responses.
 *
 * Sandbox version overridable via NEAR_SANDBOX_VERSION; defaults to a 2.13 RC.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

const SANDBOX_VERSION = process.env.NEAR_SANDBOX_VERSION ?? "2.13.0-rc.2"

describe("Gas Key Signing - Integration Test (NEAR 2.13)", () => {
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

  test("signs a transfer with a funded gas key (V1 GasKeyNonce)", async () => {
    const accountId = `gks-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const gasKey = generateKey()
    const beneficiary = `gks-recv-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the gas-key owner and a transfer recipient.
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "20 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(beneficiary)
      .transfer(beneficiary, "1 NEAR")
      .send()

    const ownerNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    // Add a gas full-access key (4 nonce slots) and fund it, atomically. Default
    // (status-bearing) send asserts the setup executed; the gas-key action and
    // permission views (added in #196) parse the echoed response.
    const setup = await ownerNear
      .transaction(accountId)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFullAccess",
        numNonces: 4,
      })
      .transferToGasKey(gasKey.publicKey.toString(), "5 NEAR")
      .send()
    expect("SuccessValue" in (setup.status as object)).toBe(true)

    // Read back the gas key's nonce slots to confirm it is queryable before we
    // sign with it.
    const nonces = (
      await near.rpc.call<{ nonces?: number[] }>(
        "EXPERIMENTAL_view_gas_key_nonces",
        {
          finality: "optimistic",
          account_id: accountId,
          public_key: gasKey.publicKey.toString(),
        },
      )
    ).nonces
    expect(nonces).toHaveLength(4)
    console.log(`✓ Gas key funded with ${nonces?.length} nonce slots`)

    // Sign a transfer WITH the gas key, using nonce slot 0. This builds and
    // signs a V1 transaction whose nonce is a GasKeyNonce { nonce, index }.
    const result = await ownerNear
      .transaction(accountId)
      .signWith(gasKey.secretKey)
      .useGasKey(0)
      .transfer(beneficiary, "1 NEAR")
      .send()

    // Status-bearing response: assert the node executed it successfully.
    expect(result.status).toBeDefined()
    expect("Failure" in (result.status as object)).toBe(false)
    expect("SuccessValue" in (result.status as object)).toBe(true)
    console.log(
      `✓ Gas-key-signed transfer executed: ${result.transaction?.hash}`,
    )
  }, 120000)

  test("strict nonce mode sends a transfer accepted by the node", async () => {
    // Strict mode requires nonce === ak_nonce + 1; the builder bypasses the
    // monotonic nonce cache and fetches the chain nonce directly. This proves
    // the resulting V1 (strict) transaction is accepted on-chain.
    const accountId = `strict-${Date.now()}.${sandbox.rootAccount.id}`
    const accountKey = generateKey()
    const recipientId = `strict-recv-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .addKey(accountKey.publicKey.toString(), { type: "fullAccess" })
      .send()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "1 NEAR")
      .send()

    const accountNear = new Near({
      network: sandbox,
      keyStore: { [accountId]: accountKey.secretKey },
    })

    const result = await accountNear
      .transaction(accountId)
      .strictNonceMode()
      .transfer(recipientId, "1 NEAR")
      .send()

    expect("SuccessValue" in (result.status as object)).toBe(true)
    console.log(`✓ Strict-nonce transfer executed: ${result.transaction?.hash}`)
  }, 120000)
})
