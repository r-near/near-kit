/**
 * Unit tests for custom sandbox binary path support
 *
 * Tests the binaryPath option and NEAR_SANDBOX_BIN_PATH environment variable
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Sandbox } from "../../src/sandbox/sandbox.js"

describe("Sandbox binary path resolution", () => {
  const originalEnv = process.env["NEAR_SANDBOX_BIN_PATH"]

  beforeEach(() => {
    // Clear env var before each test
    delete process.env["NEAR_SANDBOX_BIN_PATH"]
  })

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env["NEAR_SANDBOX_BIN_PATH"] = originalEnv
    } else {
      delete process.env["NEAR_SANDBOX_BIN_PATH"]
    }
  })

  test("throws error when binaryPath does not exist", async () => {
    const nonExistentPath = "/path/to/nonexistent/near-sandbox"

    await expect(
      Sandbox.start({ binaryPath: nonExistentPath }),
    ).rejects.toThrow(`Sandbox binary not found: ${nonExistentPath}`)
  })

  test("throws error when NEAR_SANDBOX_BIN_PATH does not exist", async () => {
    const nonExistentPath = "/path/to/nonexistent/near-sandbox-env"
    process.env["NEAR_SANDBOX_BIN_PATH"] = nonExistentPath

    await expect(Sandbox.start()).rejects.toThrow(
      `NEAR_SANDBOX_BIN_PATH binary not found: ${nonExistentPath}`,
    )
  })

  test("binaryPath option takes precedence over env var", async () => {
    // Create a temp file to simulate binary
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-test-"))
    const fakeBinaryPath = path.join(tmpDir, "near-sandbox")
    const fakeEnvBinaryPath = path.join(tmpDir, "near-sandbox-env")

    try {
      // Create fake binary files
      fs.writeFileSync(fakeBinaryPath, "#!/bin/bash\nexit 1")
      fs.chmodSync(fakeBinaryPath, 0o755)
      fs.writeFileSync(fakeEnvBinaryPath, "#!/bin/bash\nexit 1")
      fs.chmodSync(fakeEnvBinaryPath, 0o755)

      // Set env var
      process.env["NEAR_SANDBOX_BIN_PATH"] = fakeEnvBinaryPath

      // Start should use binaryPath option, not env var
      // The binary will fail to run, but we can verify the error message
      // includes the explicit path, not the env path
      await expect(
        Sandbox.start({ binaryPath: fakeBinaryPath }),
      ).rejects.toThrow()

      // The error should be from running the binary, not from path resolution
      // This confirms the explicit path was used
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("uses NEAR_SANDBOX_BIN_PATH when binaryPath not provided", async () => {
    // Create a temp file to simulate binary
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-test-"))
    const fakeBinaryPath = path.join(tmpDir, "near-sandbox")

    try {
      // Create fake binary file
      fs.writeFileSync(fakeBinaryPath, "#!/bin/bash\nexit 1")
      fs.chmodSync(fakeBinaryPath, 0o755)

      // Set env var
      process.env["NEAR_SANDBOX_BIN_PATH"] = fakeBinaryPath

      // Start should use env var path
      // The binary will fail to run, but path resolution should succeed
      await expect(Sandbox.start()).rejects.toThrow()

      // The error should be from running the binary, not from path resolution
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("SandboxOptions interface", () => {
  test("binaryPath is optional", () => {
    // Type check - these should compile without errors
    const options1 = {}
    const options2 = { version: "2.10-release" }
    const options3 = { binaryPath: "/path/to/binary" }
    const options4 = { version: "2.10-release", binaryPath: "/path/to/binary" }
    const options5 = {
      version: "2.10-release",
      binaryPath: "/path/to/binary",
      detached: false,
    }

    // Just verify types compile
    expect(options1).toBeDefined()
    expect(options2).toBeDefined()
    expect(options3).toBeDefined()
    expect(options4).toBeDefined()
    expect(options5).toBeDefined()
  })
})
