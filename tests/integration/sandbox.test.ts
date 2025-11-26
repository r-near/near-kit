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
    expect(status.chainId).toBe("localnet")
    console.log(
      `✓ Near client connected, block height: ${status.latestBlockHeight}`,
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

    expect(status1.chainId).toBe("localnet")
    expect(status2.chainId).toBe("localnet")

    await sandbox1.stop()
    await sandbox2.stop()

    console.log("✓ Both sandboxes stopped successfully")
  }, 180000) // Extra time for multiple instances
})

describe("Sandbox - Version Support", () => {
  test("can specify sandbox version", async () => {
    const sandbox = await Sandbox.start({ version: "2.9.0" })

    expect(sandbox).toBeDefined()
    expect(sandbox.rpcUrl).toBeDefined()

    const near = new Near({ network: sandbox })
    const status = await near.getStatus()
    expect(status.chainId).toBe("localnet")

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
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  test("can fast forward by blocks", async () => {
    // Get initial block height
    const initialStatus = await near.getStatus()
    const initialHeight = initialStatus.latestBlockHeight

    // Fast forward by 100 blocks
    await sandbox.fastForward(100)

    // Get new block height
    const newStatus = await near.getStatus()
    const newHeight = newStatus.latestBlockHeight

    // The new height should be at least 100 blocks higher
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
})

describe("Sandbox - Patch State", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  test("can patch account state", async () => {
    // Create a test account first
    const testAccountId = `test-patch-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account using transaction
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testAccountId)
      .transfer(testAccountId, "10 NEAR")
      .send()

    // Get initial balance
    const initialBalance = await near.getBalance(testAccountId)
    console.log(`✓ Initial balance: ${initialBalance} NEAR`)

    // Patch the account state to increase balance
    const newBalance = "1000000000000000000000000000" // 1000 NEAR in yoctoNEAR
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

    // Verify the balance changed
    const patchedBalance = await near.getBalance(testAccountId)
    expect(Number.parseFloat(patchedBalance)).toBeGreaterThan(
      Number.parseFloat(initialBalance),
    )
    console.log(`✓ Patched balance: ${patchedBalance} NEAR`)
  })

  test("can patch contract data", async () => {
    // This test creates a simple state record for contract data
    // The format matches what the sandbox expects
    const testContractId = `contract-${Date.now()}.${sandbox.rootAccount.id}`

    // Create the account for the contract
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(testContractId)
      .transfer(testContractId, "10 NEAR")
      .send()

    // Patch contract data
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

    // This should succeed without error
    await sandbox.patchState(records)
    console.log(`✓ Contract data patched successfully`)
  })
})

describe("Sandbox - State Snapshots", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  test("can dump and restore state", async () => {
    // Get initial state
    const snapshot = await sandbox.dumpState()
    expect(snapshot.records).toBeDefined()
    expect(Array.isArray(snapshot.records)).toBe(true)
    expect(snapshot.timestamp).toBeDefined()

    console.log(`✓ State dumped with ${snapshot.records.length} records`)

    // Restore state (should not throw)
    await sandbox.restoreState(snapshot)
    console.log("✓ State restored successfully")
  })

  test("can save and load snapshot from file", async () => {
    // Save snapshot to file
    const snapshotPath = await sandbox.saveSnapshot()
    expect(snapshotPath).toBeDefined()
    expect(snapshotPath.endsWith(".json")).toBe(true)

    console.log(`✓ Snapshot saved to: ${snapshotPath}`)

    // Load snapshot from file
    const loadedSnapshot = await sandbox.loadSnapshot(snapshotPath)
    expect(loadedSnapshot.records).toBeDefined()
    expect(Array.isArray(loadedSnapshot.records)).toBe(true)
    expect(loadedSnapshot.timestamp).toBeDefined()

    console.log(
      `✓ Snapshot loaded with ${loadedSnapshot.records.length} records`,
    )
  })
})

describe("Sandbox - Restart", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  test("can restart sandbox", async () => {
    // Get initial status
    const near = new Near({ network: sandbox })
    const initialStatus = await near.getStatus()
    expect(initialStatus.chainId).toBe("localnet")

    // Restart the sandbox
    await sandbox.restart()

    // Verify sandbox is still working
    const newNear = new Near({ network: sandbox })
    const newStatus = await newNear.getStatus()
    expect(newStatus.chainId).toBe("localnet")

    // Block height should be reset to 0 (or close to it)
    expect(newStatus.latestBlockHeight).toBeLessThan(
      initialStatus.latestBlockHeight,
    )

    console.log(`✓ Sandbox restarted successfully`)
    console.log(`  Initial height: ${initialStatus.latestBlockHeight}`)
    console.log(`  New height: ${newStatus.latestBlockHeight}`)
  }, 60000)

  test("can restart with snapshot", async () => {
    // Get initial state dump
    const snapshot = await sandbox.dumpState()
    console.log(`✓ Initial snapshot has ${snapshot.records.length} records`)

    // Restart with snapshot
    await sandbox.restart(snapshot)

    // Verify sandbox is working
    const newNear = new Near({ network: sandbox })
    const status = await newNear.getStatus()
    expect(status.chainId).toBe("localnet")

    console.log("✓ Sandbox restarted with snapshot successfully")
  }, 60000)
})
