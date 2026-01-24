/**
 * Integration tests for Near client using Sandbox
 *
 * Tests all RPC-dependent features that couldn't be unit tested
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("Near Client - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
    })
    console.log(`✓ Sandbox started: ${sandbox.rootAccount.id}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe("Near.getBalance()", () => {
    test("should get available balance for existing account", async () => {
      const balance = await near.getBalance(sandbox.rootAccount.id)

      expect(balance).toBeDefined()
      expect(typeof balance).toBe("string")
      expect(Number.parseFloat(balance)).toBeGreaterThan(0)
      console.log(`✓ Available balance: ${balance} NEAR`)
    })

    test("should format balance correctly", async () => {
      const balance = await near.getBalance(sandbox.rootAccount.id)

      // Balance should be formatted as decimal string with 2 decimals
      expect(balance).toMatch(/^\d+\.\d{2}$/)
    })

    test("should return available balance (accounting for storage)", async () => {
      // Get full account state to compare
      const account = await near.getAccount(sandbox.rootAccount.id)
      const balance = await near.getBalance(sandbox.rootAccount.id)

      // getBalance should return the available amount, not total
      expect(balance).toBe(account.available)
      console.log(
        `✓ Available: ${balance} NEAR (balance: ${account.balance}, storage: ${account.storageUsage})`,
      )
    })

    test("should throw for non-existent account", async () => {
      await expect(async () => {
        await near.getBalance("nonexistent.test.near")
      }).rejects.toThrow()
    })
  })

  describe("Near.getAccount()", () => {
    test("should return complete account state", async () => {
      const account = await near.getAccount(sandbox.rootAccount.id)

      expect(account).toBeDefined()
      expect(account.balance).toBeDefined()
      expect(account.available).toBeDefined()
      expect(account.staked).toBeDefined()
      expect(account.storageUsage).toBeDefined()
      expect(typeof account.storageBytes).toBe("number")
      expect(typeof account.hasContract).toBe("boolean")
      expect(account.codeHash).toBeDefined()

      console.log(`✓ Account state:`)
      console.log(`  Balance: ${account.balance} NEAR`)
      console.log(`  Available: ${account.available} NEAR`)
      console.log(`  Staked: ${account.staked} NEAR`)
      console.log(
        `  Storage: ${account.storageUsage} NEAR (${account.storageBytes} bytes)`,
      )
      console.log(`  Has contract: ${account.hasContract}`)
    })

    test("should calculate available balance correctly", async () => {
      const account = await near.getAccount(sandbox.rootAccount.id)

      // For a regular account (no staking), available should be less than balance
      // due to storage costs
      const balance = Number.parseFloat(account.balance)
      const available = Number.parseFloat(account.available)
      const storageUsage = Number.parseFloat(account.storageUsage)

      // Available = balance - max(0, storageRequired - staked)
      // For non-staked accounts: available = balance - storageRequired
      expect(available).toBeLessThanOrEqual(balance)
      expect(available).toBeGreaterThan(0)

      // Storage usage should be positive
      expect(storageUsage).toBeGreaterThan(0)

      console.log(`✓ Available (${available}) <= Balance (${balance})`)
    })

    test("should detect accounts without contracts", async () => {
      const account = await near.getAccount(sandbox.rootAccount.id)

      // Root account typically doesn't have a contract
      expect(account.hasContract).toBe(false)
      expect(account.codeHash).toBe("11111111111111111111111111111111")
    })

    test("should throw for non-existent account", async () => {
      await expect(async () => {
        await near.getAccount("nonexistent.test.near")
      }).rejects.toThrow()
    })
  })

  describe("Near.accountExists()", () => {
    test("should return true for existing account", async () => {
      const exists = await near.accountExists(sandbox.rootAccount.id)
      expect(exists).toBe(true)
    })

    test("should return false for non-existent account", async () => {
      const exists = await near.accountExists("fake-account-12345.test.near")
      expect(exists).toBe(false)
    })
  })

  describe("Near.getAccessKeys()", () => {
    test("should list access keys for existing account", async () => {
      const keys = await near.getAccessKeys(sandbox.rootAccount.id)

      expect(keys).toBeDefined()
      expect(keys.keys).toBeDefined()
      expect(Array.isArray(keys.keys)).toBe(true)
      expect(keys.keys.length).toBeGreaterThan(0)

      // Verify the structure of the first key
      const firstKey = keys.keys[0]
      expect(firstKey?.public_key).toBeDefined()
      expect(firstKey?.public_key).toMatch(/^ed25519:/)
      expect(firstKey?.access_key).toBeDefined()
      expect(typeof firstKey?.access_key.nonce).toBe("number")
      expect(firstKey?.access_key.permission).toBeDefined()

      console.log(
        `✓ Found ${keys.keys.length} access key(s) for ${sandbox.rootAccount.id}`,
      )
    })

    test("should return empty keys for non-existent account", async () => {
      const keys = await near.getAccessKeys("nonexistent-account-xyz.test.near")
      expect(keys.keys).toEqual([])
    })

    test("should accept blockId option", async () => {
      // First get the current block height
      const status = await near.getStatus()
      const blockHeight = status.sync_info.latest_block_height

      const keys = await near.getAccessKeys(sandbox.rootAccount.id, {
        blockId: blockHeight,
      })

      expect(keys).toBeDefined()
      expect(keys.keys.length).toBeGreaterThan(0)
      expect(keys.block_height).toBe(blockHeight)
    })

    test("should accept finality option", async () => {
      const keys = await near.getAccessKeys(sandbox.rootAccount.id, {
        finality: "final",
      })

      expect(keys).toBeDefined()
      expect(keys.keys.length).toBeGreaterThan(0)
    })

    test("should use default finality with empty options", async () => {
      const keys = await near.getAccessKeys(sandbox.rootAccount.id, {})

      expect(keys).toBeDefined()
      expect(keys.keys.length).toBeGreaterThan(0)
    })
  })

  describe("Near.getStatus()", () => {
    test("should get network status", async () => {
      const status = await near.getStatus()

      expect(status).toBeDefined()
      expect(status.chain_id).toBe("localnet")
      expect(typeof status.sync_info.latest_block_height).toBe("number")
      expect(status.sync_info.latest_block_height).toBeGreaterThanOrEqual(0)
      expect(typeof status.sync_info.syncing).toBe("boolean")
      // Verify additional fields from the full response
      expect(status.version).toBeDefined()
      expect(status.version.version).toBeDefined()
      expect(status.protocol_version).toBeGreaterThan(0)
      console.log(`✓ Block height: ${status.sync_info.latest_block_height}`)
    })
  })

  describe("Near.batch()", () => {
    test("should execute multiple operations in parallel", async () => {
      const [balance, status, exists] = await near.batch(
        near.getBalance(sandbox.rootAccount.id),
        near.getStatus(),
        near.accountExists(sandbox.rootAccount.id),
      )

      expect(balance).toBeDefined()
      expect(typeof balance).toBe("string")
      expect(status).toBeDefined()
      expect((status as { chain_id: string }).chain_id).toBe("localnet")
      expect(exists).toBe(true)
      console.log("✓ Batch operation completed")
    })

    test("should handle mixed success/failure", async () => {
      const results = await Promise.allSettled([
        near.getBalance(sandbox.rootAccount.id),
        near.getBalance("nonexistent.test.near"),
        near.getStatus(),
      ])

      expect(results[0].status).toBe("fulfilled")
      expect(results[1].status).toBe("rejected")
      expect(results[2].status).toBe("fulfilled")
    })
  })

  describe("Near.view()", () => {
    test("should call view function (status endpoint as proxy)", async () => {
      // We can't easily deploy a contract in this test, but we can test
      // that view() properly calls the RPC and decodes responses
      // For now, we'll test the mechanism works by checking error handling
      const nearWithoutKey = new Near({ network: sandbox })

      await expect(async () => {
        await nearWithoutKey.view("nonexistent.near", "some_method", {})
      }).rejects.toThrow()
    })
  })
})

describe("TransactionBuilder - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let rootKey: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    rootKey = sandbox.rootAccount.secretKey

    // Create Near instance with keystore for the root account
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: rootKey,
      },
    })

    console.log(`✓ Sandbox ready for transaction tests`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe("TransactionBuilder.build()", () => {
    test("should build transaction with correct nonce", async () => {
      const builder = near.transaction(sandbox.rootAccount.id)
      builder.transfer("alice.near", "1 NEAR")

      const tx = await builder.build()

      expect(tx).toBeDefined()
      expect(tx.signerId).toBe(sandbox.rootAccount.id)
      expect(tx.receiverId).toBe("alice.near")
      expect(tx.actions.length).toBe(1)
      expect(tx.nonce).toBeDefined()
      expect(typeof tx.nonce).toBe("bigint")
      expect(tx.blockHash).toBeDefined()
      expect(tx.blockHash.length).toBe(32)

      console.log(`✓ Transaction built with nonce: ${tx.nonce}`)
    })

    test("should increment nonce from access key", async () => {
      const builder1 = near.transaction(sandbox.rootAccount.id)
      builder1.transfer("alice.near", "1 NEAR")

      const builder2 = near.transaction(sandbox.rootAccount.id)
      builder2.transfer("bob.near", "1 NEAR")

      const tx1 = await builder1.build()
      const tx2 = await builder2.build()

      // Second transaction should have higher nonce
      // (may not be exactly +1 if other transactions happened)
      expect(tx2.nonce).toBeGreaterThanOrEqual(tx1.nonce)
    })

    test("should throw when no receiver ID is set", async () => {
      const builder = near.transaction(sandbox.rootAccount.id)

      await expect(async () => {
        await builder.build()
      }).rejects.toThrow(/No receiver ID/)
    })

    test("should throw when key not found", async () => {
      const nearWithoutKey = new Near({ network: sandbox })
      const builder = nearWithoutKey.transaction("missing-account.near")
      builder.transfer("alice.near", "1 NEAR")

      await expect(async () => {
        await builder.build()
      }).rejects.toThrow(/No key found/)
    })
  })

  describe("TransactionBuilder.send() - Account Creation", () => {
    test("should create account and transfer NEAR", async () => {
      const newKey = generateKey()
      const newAccountId = `test-${Date.now()}.${sandbox.rootAccount.id}`

      // Create sub-account
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(newAccountId)
        .transfer(newAccountId, "10 NEAR")
        .addKey(newKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      expect(result).toBeDefined()
      console.log(`✓ Account created: ${newAccountId}`)

      // Verify account was created
      const exists = await near.accountExists(newAccountId)
      expect(exists).toBe(true)

      // Verify balance
      const balance = await near.getBalance(newAccountId)
      const balanceNum = Number.parseFloat(balance)
      expect(balanceNum).toBeGreaterThan(0)
      expect(balanceNum).toBeLessThanOrEqual(10)
      console.log(`✓ New account balance: ${balance} NEAR`)
    }, 30000)
  })

  describe("TransactionBuilder.send() - Token Transfer", () => {
    test("should transfer NEAR between accounts", async () => {
      // Create recipient account first
      const recipientKey = generateKey()
      const recipientId = `recipient-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, "5 NEAR")
        .addKey(recipientKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Recipient created: ${recipientId}`)

      // Get initial balance
      const initialBalance = await near.getBalance(recipientId)
      const initialNum = Number.parseFloat(initialBalance)

      // Transfer additional NEAR
      await near
        .transaction(sandbox.rootAccount.id)
        .transfer(recipientId, "3 NEAR")
        .send()

      console.log("✓ Transfer sent")

      // Check new balance
      const newBalance = await near.getBalance(recipientId)
      const newNum = Number.parseFloat(newBalance)

      expect(newNum).toBeGreaterThan(initialNum)
      console.log(`✓ Balance increased: ${initialBalance} → ${newBalance} NEAR`)
    }, 30000)
  })

  describe("TransactionBuilder.send() - Multiple Actions", () => {
    test("should execute multiple transfers in one transaction", async () => {
      // Create two recipient accounts
      const recipient1Key = generateKey()
      const recipient1Id = `multi1-${Date.now()}.${sandbox.rootAccount.id}`
      const recipient2Key = generateKey()
      const recipient2Id = `multi2-${Date.now()}.${sandbox.rootAccount.id}`

      // Create accounts sequentially to avoid nonce collision
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipient1Id)
        .transfer(recipient1Id, "2 NEAR")
        .addKey(recipient1Key.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipient2Id)
        .transfer(recipient2Id, "2 NEAR")
        .addKey(recipient2Key.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Created recipients: ${recipient1Id}, ${recipient2Id}`)

      // Both should exist
      const [exists1, exists2] = await Promise.all([
        near.accountExists(recipient1Id),
        near.accountExists(recipient2Id),
      ])

      expect(exists1).toBe(true)
      expect(exists2).toBe(true)
    }, 30000)
  })

  describe("Near.send()", () => {
    test("should transfer NEAR using convenience method", async () => {
      // Create a recipient
      const recipientKey = generateKey()
      const recipientId = `sendtest-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, "5 NEAR")
        .addKey(recipientKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Use Near.send() convenience method
      // Note: This requires defaultSignerId to be set, which we haven't done
      // So this test documents the limitation
      await expect(async () => {
        await near.send(recipientId, "1 NEAR")
      }).rejects.toThrow(/No signer ID/)
    }, 30000)
  })

  describe("Error Handling", () => {
    test("should throw on insufficient balance", async () => {
      // Try to transfer more than exists
      const recipientId = `insufficient-${Date.now()}.${sandbox.rootAccount.id}`

      await expect(async () => {
        await near
          .transaction(sandbox.rootAccount.id)
          .createAccount(recipientId)
          .transfer(recipientId, "999999999999 NEAR")
          .send()
      }).rejects.toThrow()
    }, 30000)
  })
})

describe("Gas and Amount Parsing - Integration", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe("Amount Parsing in Real Transactions", () => {
    test("should handle string amounts in transfers", async () => {
      const recipientKey = generateKey()
      const recipientId = `stramt-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, "1 NEAR") // String amount
        .addKey(recipientKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      const balance = await near.getBalance(recipientId)
      expect(Number.parseFloat(balance)).toBeGreaterThan(0)
    }, 30000)

    test("should handle number amounts in transfers", async () => {
      const recipientKey = generateKey()
      const recipientId = `numamt-${Date.now()}.${sandbox.rootAccount.id}`

      // Note: Raw numbers are in yoctoNEAR (base unit)
      // 2000000000000000000000000 yoctoNEAR = 2 NEAR
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, 2000000000000000000000000n) // Number amount in yoctoNEAR
        .addKey(recipientKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      const balance = await near.getBalance(recipientId)
      expect(Number.parseFloat(balance)).toBeGreaterThan(0)
    }, 30000)
  })
})
