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

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"

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
