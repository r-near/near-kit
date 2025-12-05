/**
 * High-Throughput Transactions with RotatingKeyStore
 *
 * Demonstrates using multiple access keys per account to send many concurrent
 * transactions without nonce collisions.
 *
 * Run: bun run examples/rotating-keystore.ts
 */

import { Near, RotatingKeyStore } from "../src/index.js"
import { Sandbox } from "../src/sandbox/index.js"
import { generateKey } from "../src/utils/key.js"

// ============================================================================
// High-Throughput Bot Pattern
// ============================================================================

async function highThroughputExample() {
  console.log("Starting sandbox...")
  const sandbox = await Sandbox.start()

  try {
    const rootNear = new Near({
      network: sandbox,
      keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
    })

    // Create bot account with initial key
    const botAccount = `bot-${Date.now()}.${sandbox.rootAccount.id}`
    const key1 = generateKey()

    console.log(`Creating bot account: ${botAccount}`)
    await rootNear
      .transaction(sandbox.rootAccount.id)
      .createAccount(botAccount)
      .transfer(botAccount, "50 NEAR")
      .addKey(key1.publicKey.toString(), { type: "fullAccess" })
      .send()

    // Add additional keys to the account
    const key2 = generateKey()
    const key3 = generateKey()
    const key4 = generateKey()
    const key5 = generateKey()

    const botNear = new Near({
      network: sandbox,
      keyStore: { [botAccount]: key1.secretKey },
    })

    console.log("Adding 4 more access keys to bot account...")
    await botNear
      .transaction(botAccount)
      .addKey(key2.publicKey.toString(), { type: "fullAccess" })
      .addKey(key3.publicKey.toString(), { type: "fullAccess" })
      .addKey(key4.publicKey.toString(), { type: "fullAccess" })
      .addKey(key5.publicKey.toString(), { type: "fullAccess" })
      .send()

    // Create RotatingKeyStore with all 5 keys
    const keyStore = new RotatingKeyStore({
      [botAccount]: [
        key1.secretKey,
        key2.secretKey,
        key3.secretKey,
        key4.secretKey,
        key5.secretKey,
      ],
    })

    const near = new Near({ network: sandbox, keyStore })

    // Create recipients for transfers
    const recipients = Array.from({ length: 20 }, (_, i) => ({
      id: `recipient-${i}-${Date.now()}.${sandbox.rootAccount.id}`,
    }))

    // Create all recipient accounts first
    console.log("Creating 20 recipient accounts...")
    for (const recipient of recipients) {
      await rootNear
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipient.id)
        .transfer(recipient.id, "0.1 NEAR")
        .send()
    }

    // Send 20 concurrent transfers - no nonce collisions!
    console.log("\nSending 20 concurrent transfers...")
    const startTime = Date.now()

    const promises = recipients.map((recipient) =>
      near.transaction(botAccount).transfer(recipient.id, "0.5 NEAR").send(),
    )

    const results = await Promise.allSettled(promises)
    const duration = Date.now() - startTime

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    console.log(`\nResults:`)
    console.log(`  Succeeded: ${succeeded}/20`)
    console.log(`  Failed: ${failed}/20`)
    console.log(`  Duration: ${duration}ms`)
    console.log(
      `  Throughput: ${((succeeded / duration) * 1000).toFixed(1)} tx/s`,
    )

    // Verify balances
    const balances = await Promise.all(
      recipients.slice(0, 3).map((r) => near.getBalance(r.id)),
    )
    console.log(`\nSample recipient balances:`)
    for (let i = 0; i < balances.length; i++) {
      console.log(`  ${recipients[i]?.id}: ${balances[i]}`)
    }
  } finally {
    await sandbox.stop()
    console.log("\nSandbox stopped")
  }
}

// ============================================================================
// Run
// ============================================================================

console.log("RotatingKeyStore Example\n")
console.log("This example demonstrates high-throughput concurrent transactions")
console.log("using multiple access keys per account.\n")

highThroughputExample().catch(console.error)
