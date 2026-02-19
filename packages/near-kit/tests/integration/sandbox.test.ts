/**
 * Integration tests for NEAR Sandbox
 *
 * Tests sandbox lifecycle and integration with Near client
 *
 * NOTE: These tests require system file descriptor limit >= 65,535
 * Check with: ulimit -n
 *
 * To fix on Linux, add to /etc/security/limits.conf:
 *   * soft nofile 65535
 *   * hard nofile 65535
 *
 * To fix on macOS:
 *   sudo launchctl limit maxfiles 65536 200000
 *
 * For Docker/CI:
 *   docker run --ulimit nofile=65535:65535 ...
 *
 * See src/sandbox/README.md for more details.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import type { StateRecord } from "../../src/sandbox/sandbox.js"
import { EMPTY_CODE_HASH, Sandbox } from "../../src/sandbox/sandbox.js"

describe("Sandbox", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    // Start sandbox before all tests
    sandbox = await Sandbox.start()
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000) // Increase timeout for binary download

  afterAll(async () => {
    // Stop sandbox after all tests
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  test("sandbox has correct properties", () => {
    expect(sandbox).toBeDefined()
    expect(sandbox.rpcUrl).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
    expect(sandbox.networkId).toBe("localnet")
    expect(sandbox.rootAccount).toBeDefined()
    expect(sandbox.rootAccount.id).toBeDefined()
    expect(sandbox.rootAccount.secretKey).toBeDefined()
    console.log(`✓ Root account: ${sandbox.rootAccount.id}`)
  })

  test("can create Near client with sandbox", async () => {
    const near = new Near({ network: sandbox })

    // Test that RPC is working
    const status = await near.getStatus()
    expect(status).toBeDefined()
    expect(status.chain_id).toBe("localnet")
    console.log(
      `✓ Near client connected, block height: ${status.sync_info.latest_block_height}`,
    )
  })

  test("can check root account balance", async () => {
    const near = new Near({ network: sandbox })

    const balance = await near.getBalance(sandbox.rootAccount.id)
    expect(balance).toBeDefined()
    expect(Number.parseFloat(balance)).toBeGreaterThan(0)
    console.log(`✓ Root account balance: ${balance} NEAR`)
  })

  test("root account exists", async () => {
    const near = new Near({ network: sandbox })

    const exists = await near.accountExists(sandbox.rootAccount.id)
    expect(exists).toBe(true)
    console.log(`✓ Root account exists: ${sandbox.rootAccount.id}`)
  })

  test("non-existent account does not exist", async () => {
    const near = new Near({ network: sandbox })

    const exists = await near.accountExists("nonexistent.test.near")
    expect(exists).toBe(false)
    console.log("✓ Non-existent account check works")
  })
})

describe("Sandbox - Multiple Instances", () => {
  test("can run multiple sandbox instances", async () => {
    const sandbox1 = await Sandbox.start()
    const sandbox2 = await Sandbox.start()

    expect(sandbox1.rpcUrl).toBeDefined()
    expect(sandbox2.rpcUrl).toBeDefined()
    expect(sandbox1.rpcUrl).not.toBe(sandbox2.rpcUrl)

    console.log(`✓ Sandbox 1: ${sandbox1.rpcUrl}`)
    console.log(`✓ Sandbox 2: ${sandbox2.rpcUrl}`)

    // Both should be working
    const near1 = new Near({ network: sandbox1 })
    const near2 = new Near({ network: sandbox2 })

    const [status1, status2] = await Promise.all([
      near1.getStatus(),
      near2.getStatus(),
    ])

    expect(status1.chain_id).toBe("localnet")
    expect(status2.chain_id).toBe("localnet")

    await sandbox1.stop()
    await sandbox2.stop()

    console.log("✓ Both sandboxes stopped successfully")
  }, 180000) // Extra time for multiple instances
})

describe("Sandbox - Version Support", () => {
  test("can specify sandbox version", async () => {
    const sandbox = await Sandbox.start({ version: "2.10-release" })

    expect(sandbox).toBeDefined()
    expect(sandbox.rpcUrl).toBeDefined()

    const near = new Near({ network: sandbox })
    const status = await near.getStatus()
    expect(status.chain_id).toBe("localnet")

    await sandbox.stop()
    console.log("✓ Sandbox with specific version works")
  }, 120000)
})

describe("Sandbox - Fast Forward", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("fast forward preserves existing state", async () => {
    const accountId = `ff-state-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "5 NEAR")
      .send()

    await sandbox.fastForward(50)

    const exists = await near.accountExists(accountId)
    expect(exists).toBe(true)

    const balance = await near.getBalance(accountId)
    expect(Number.parseFloat(balance)).toBeGreaterThan(0)
  })

  test("can fast forward by blocks", async () => {
    const initialStatus = await near.getStatus()
    const initialHeight = initialStatus.sync_info.latest_block_height

    await sandbox.fastForward(100)

    const newStatus = await near.getStatus()
    const newHeight = newStatus.sync_info.latest_block_height

    expect(newHeight).toBeGreaterThanOrEqual(initialHeight + 100)
    console.log(`✓ Fast forwarded from block ${initialHeight} to ${newHeight}`)
  })

  test("fast forward rejects non-positive block numbers", async () => {
    await expect(sandbox.fastForward(0)).rejects.toThrow(
      "numBlocks must be a positive integer",
    )
    await expect(sandbox.fastForward(-1)).rejects.toThrow(
      "numBlocks must be a positive integer",
    )
  })

  test("fast forward rejects non-integer values", async () => {
    await expect(sandbox.fastForward(1.5)).rejects.toThrow(
      "numBlocks must be a positive integer",
    )
    await expect(sandbox.fastForward(NaN)).rejects.toThrow(
      "numBlocks must be a positive integer",
    )
    await expect(sandbox.fastForward(Infinity)).rejects.toThrow(
      "numBlocks must be a positive integer",
    )
  })
})

describe("Sandbox - Patch State", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("can patch account balance", async () => {
    const testAccountId = `test-patch-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testAccountId)
      .transfer(testAccountId, "10 NEAR")
      .send()

    const initialBalance = await near.getBalance(testAccountId)
    console.log(`✓ Initial balance: ${initialBalance} NEAR`)

    const newBalance = "1000000000000000000000000000" // 1000 NEAR
    const records: StateRecord[] = [
      {
        Account: {
          account_id: testAccountId,
          account: {
            amount: newBalance,
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
    ]

    await sandbox.patchState(records)

    // Should see the patched balance immediately (no race condition)
    const patchedBalance = await near.getBalance(testAccountId)
    expect(Number.parseFloat(patchedBalance)).toBeGreaterThan(
      Number.parseFloat(initialBalance),
    )
    console.log(`✓ Patched balance: ${patchedBalance} NEAR`)
  })

  test("can patch contract data", async () => {
    const testContractId = `contract-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testContractId)
      .transfer(testContractId, "10 NEAR")
      .send()

    const dataKey = Buffer.from("STATE").toString("base64")
    const dataValue = Buffer.from(JSON.stringify({ count: 42 })).toString(
      "base64",
    )

    const records: StateRecord[] = [
      {
        Data: {
          account_id: testContractId,
          data_key: dataKey,
          value: dataValue,
        },
      },
    ]

    await sandbox.patchState(records)
    console.log("✓ Contract data patched successfully")
  })

  test("can patch multiple records at once", async () => {
    const account1 = `multi-patch-1-${Date.now()}.${sandbox.rootAccount.id}`
    const account2 = `multi-patch-2-${Date.now()}.${sandbox.rootAccount.id}`

    // Create both accounts
    for (const id of [account1, account2]) {
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(id)
        .transfer(id, "5 NEAR")
        .send()
    }

    // Patch both balances in a single call
    await sandbox.patchState([
      {
        Account: {
          account_id: account1,
          account: {
            amount: "100000000000000000000000000", // 100 NEAR
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
      {
        Account: {
          account_id: account2,
          account: {
            amount: "200000000000000000000000000", // 200 NEAR
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
    ])

    const balance1 = await near.getBalance(account1)
    const balance2 = await near.getBalance(account2)

    expect(Number.parseFloat(balance1)).toBeCloseTo(100, 0)
    expect(Number.parseFloat(balance2)).toBeCloseTo(200, 0)
  })

  test("can patch access key records", async () => {
    const accountId = `ak-patch-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "5 NEAR")
      .send()

    // Patch a function-call access key onto the account
    await sandbox.patchState([
      {
        AccessKey: {
          account_id: accountId,
          public_key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
          access_key: {
            nonce: 0,
            permission: {
              FunctionCall: {
                allowance: "250000000000000000000000", // 0.25 NEAR
                receiver_id: accountId,
                method_names: ["get_status"],
              },
            },
          },
        },
      },
    ])

    // Verify via RPC that the account's access keys now include the patched one
    const keyList = await near.getAccessKeys(accountId)
    const functionCallKey = keyList.keys.find(
      (k) =>
        k.public_key === "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
    )
    expect(functionCallKey).toBeDefined()
    expect(functionCallKey?.access_key.permission).not.toBe("FullAccess")
  })

  test("patched state is visible immediately after patchState returns", async () => {
    // This test specifically verifies the race condition fix:
    // patchState should wait for the next block before returning,
    // so subsequent reads always see the updated state.
    const testAccountId = `race-test-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testAccountId)
      .transfer(testAccountId, "5 NEAR")
      .send()

    // Patch to exactly 500 NEAR
    const exactBalance = "500000000000000000000000000"
    await sandbox.patchState([
      {
        Account: {
          account_id: testAccountId,
          account: {
            amount: exactBalance,
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
    ])

    // Read IMMEDIATELY — should see 500 NEAR, not the old 5 NEAR
    const balance = await near.getBalance(testAccountId)
    expect(Number.parseFloat(balance)).toBeCloseTo(500, 0)
    console.log(`✓ Race condition test passed: balance = ${balance} NEAR`)
  })
})

describe("Sandbox - State Snapshots", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.start()
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("can dump and restore state", async () => {
    const snapshot = await sandbox.dumpState()
    expect(snapshot.records).toBeDefined()
    expect(Array.isArray(snapshot.records)).toBe(true)
    expect(snapshot.timestamp).toBeDefined()

    console.log(`✓ State dumped with ${snapshot.records.length} records`)

    await sandbox.restoreState(snapshot)
    console.log("✓ State restored successfully")
  })

  test("can save and load snapshot from file", async () => {
    const snapshotPath = await sandbox.saveSnapshot()
    expect(snapshotPath).toBeDefined()
    expect(snapshotPath.endsWith(".json")).toBe(true)

    console.log(`✓ Snapshot saved to: ${snapshotPath}`)

    const loadedSnapshot = await sandbox.loadSnapshot(snapshotPath)
    expect(loadedSnapshot.records).toBeDefined()
    expect(Array.isArray(loadedSnapshot.records)).toBe(true)
    expect(loadedSnapshot.timestamp).toBeDefined()

    console.log(
      `✓ Snapshot loaded with ${loadedSnapshot.records.length} records`,
    )
  })

  test("dump state after transaction sees the transaction's effects", async () => {
    const near = new Near({ network: sandbox })
    const testAccountId = `dump-test-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testAccountId)
      .transfer(testAccountId, "10 NEAR")
      .send()

    // Dump state immediately after transaction
    const snapshot = await sandbox.dumpState()

    // The snapshot should contain our newly created account
    const hasAccount = snapshot.records.some(
      (r) => r.Account?.account_id === testAccountId,
    )
    expect(hasAccount).toBe(true)
    console.log(
      `✓ State dump after transaction contains new account (${snapshot.records.length} total records)`,
    )
  })

  test("dump state includes account and access key records", async () => {
    const snapshot = await sandbox.dumpState()

    const accountRecords = snapshot.records.filter((r) => r.Account)
    const accessKeyRecords = snapshot.records.filter((r) => r.AccessKey)

    // At minimum, the root accounts (near, test.near) should be present
    expect(accountRecords.length).toBeGreaterThanOrEqual(2)
    expect(accessKeyRecords.length).toBeGreaterThanOrEqual(1)

    // Root account should have a nonzero balance
    const rootAccount = accountRecords.find(
      (r) => r.Account?.account_id === sandbox.rootAccount.id,
    )
    expect(rootAccount).toBeDefined()
    expect(BigInt(rootAccount?.Account?.account.amount)).toBeGreaterThan(0n)
  })

  test("dump state after patch reflects patched values", async () => {
    const near = new Near({ network: sandbox })
    const accountId = `dump-patch-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "5 NEAR")
      .send()

    const patchedAmount = "777000000000000000000000000" // 777 NEAR
    await sandbox.patchState([
      {
        Account: {
          account_id: accountId,
          account: {
            amount: patchedAmount,
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
    ])

    const snapshot = await sandbox.dumpState()
    const record = snapshot.records.find(
      (r) => r.Account?.account_id === accountId,
    )
    expect(record).toBeDefined()
    expect(record?.Account?.account.amount).toBe(patchedAmount)
  })

  test("dump, modify state, then restore brings back original", async () => {
    const near = new Near({ network: sandbox })
    const accountId = `restore-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .send()

    // Snapshot the state with 10 NEAR
    const snapshot = await sandbox.dumpState()

    // Modify to 999 NEAR
    await sandbox.patchState([
      {
        Account: {
          account_id: accountId,
          account: {
            amount: "999000000000000000000000000",
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 100,
          },
        },
      },
    ])

    const modifiedBalance = await near.getBalance(accountId)
    expect(Number.parseFloat(modifiedBalance)).toBeCloseTo(999, 0)

    // Restore original snapshot
    await sandbox.restoreState(snapshot)

    const restoredBalance = await near.getBalance(accountId)
    expect(Number.parseFloat(restoredBalance)).toBeCloseTo(10, 0)
  })
})

describe("Sandbox - Restart", () => {
  test("can restart sandbox", async () => {
    const sandbox = await Sandbox.start()
    const near = new Near({ network: sandbox })

    // Produce some blocks so we can verify height resets
    await sandbox.fastForward(10)

    const initialStatus = await near.getStatus()
    expect(initialStatus.chain_id).toBe("localnet")
    expect(initialStatus.sync_info.latest_block_height).toBeGreaterThanOrEqual(
      10,
    )

    await sandbox.restart()

    const newNear = new Near({ network: sandbox })
    const newStatus = await newNear.getStatus()
    expect(newStatus.chain_id).toBe("localnet")

    // Block height should reset
    expect(newStatus.sync_info.latest_block_height).toBeLessThan(
      initialStatus.sync_info.latest_block_height,
    )

    console.log(
      `✓ Sandbox restarted: ${initialStatus.sync_info.latest_block_height} → ${newStatus.sync_info.latest_block_height}`,
    )
    await sandbox.stop()
  }, 120000)

  test("can restart with snapshot", async () => {
    const sandbox = await Sandbox.start()

    const snapshot = await sandbox.dumpState()
    console.log(`✓ Initial snapshot has ${snapshot.records.length} records`)

    await sandbox.restart(snapshot)

    const newNear = new Near({ network: sandbox })
    const status = await newNear.getStatus()
    expect(status.chain_id).toBe("localnet")

    console.log("✓ Sandbox restarted with snapshot successfully")
    await sandbox.stop()
  }, 120000)

  test("restart without snapshot clears transaction-created accounts", async () => {
    const sandbox = await Sandbox.start()
    const near = new Near({ network: sandbox })

    const accountId = `restart-clear-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "5 NEAR")
      .send()

    expect(await near.accountExists(accountId)).toBe(true)

    // Restart without snapshot — data dir is wiped, only genesis accounts survive
    await sandbox.restart()

    const newNear = new Near({ network: sandbox })
    expect(await newNear.accountExists(accountId)).toBe(false)

    // Root account should still exist (it's in genesis)
    expect(await newNear.accountExists(sandbox.rootAccount.id)).toBe(true)

    await sandbox.stop()
  }, 120000)

  test("restart with snapshot preserves snapshotted accounts", async () => {
    const sandbox = await Sandbox.start()
    const near = new Near({ network: sandbox })

    const accountId = `restart-keep-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .send()

    // Snapshot after account creation
    const snapshot = await sandbox.dumpState()
    const hasAccount = snapshot.records.some(
      (r) => r.Account?.account_id === accountId,
    )
    expect(hasAccount).toBe(true)

    // Restart with snapshot — account should survive
    await sandbox.restart(snapshot)

    const newNear = new Near({ network: sandbox })
    expect(await newNear.accountExists(accountId)).toBe(true)

    const balance = await newNear.getBalance(accountId)
    expect(Number.parseFloat(balance)).toBeGreaterThan(0)

    await sandbox.stop()
  }, 120000)

  test("restart without snapshot after restart with snapshot resets genesis cleanly", async () => {
    const sandbox = await Sandbox.start()
    const near = new Near({ network: sandbox })

    const accountId = `genesis-reset-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(accountId)
      .transfer(accountId, "10 NEAR")
      .send()

    // Bake the account into genesis via restart(snapshot)
    const snapshot = await sandbox.dumpState()
    await sandbox.restart(snapshot)

    const nearAfterSnapshot = new Near({ network: sandbox })
    expect(await nearAfterSnapshot.accountExists(accountId)).toBe(true)

    // Now restart without snapshot — should restore original genesis,
    // so the previously baked-in account should be gone
    await sandbox.restart()

    const nearAfterClean = new Near({ network: sandbox })
    expect(await nearAfterClean.accountExists(accountId)).toBe(false)

    // Root account should still exist
    expect(await nearAfterClean.accountExists(sandbox.rootAccount.id)).toBe(
      true,
    )

    await sandbox.stop()
  }, 180000)
})
