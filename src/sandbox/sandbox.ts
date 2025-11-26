/**
 * NEAR Sandbox - Local testing environment
 *
 * Simple, explicit API for running a local NEAR node for testing.
 */

import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import fs from "node:fs"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"
import * as tar from "tar"

const DEFAULT_VERSION = "2.9.0"
const BINARY_NAME = "near-sandbox"
const ARCHIVE_NAME = "near-sandbox.tar.gz"
const DOWNLOAD_BASE =
  "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore"
const STARTUP_TIMEOUT = 60000
const DOWNLOAD_TIMEOUT = 120000

interface PlatformInfo {
  system: string
  arch: string
}

interface ValidatorKey {
  account_id: string
  public_key: string
  secret_key?: string
  private_key?: string
}

/**
 * State record from sandbox state dump.
 * Used for patching state and creating snapshots.
 */
export interface StateRecord {
  Account?: {
    account_id: string
    account: {
      amount: string
      locked: string
      code_hash: string
      storage_usage: number
      version?: string
    }
  }
  AccessKey?: {
    account_id: string
    public_key: string
    access_key: {
      nonce: number
      permission:
        | "FullAccess"
        | {
            FunctionCall: {
              allowance: string | null
              receiver_id: string
              method_names: string[]
            }
          }
    }
  }
  Contract?: {
    account_id: string
    code: string // base64-encoded WASM
  }
  Data?: {
    account_id: string
    data_key: string // base64-encoded key
    value: string // base64-encoded value
  }
}

/**
 * State snapshot for restoring sandbox state between tests.
 */
export interface StateSnapshot {
  records: StateRecord[]
  timestamp: number
}

export interface SandboxOptions {
  version?: string
  /**
   * Whether to spawn the sandbox process as detached.
   * Default: true
   * Set to false in test environments to prevent the process from being killed by test runners.
   */
  detached?: boolean
}

/**
 * NEAR Sandbox instance
 *
 * Manages a local NEAR node for testing. Automatically cleans up on stop().
 *
 * @example
 * ```typescript
 * const sandbox = await Sandbox.start();
 * const near = new Near({ network: sandbox });
 * // ... run tests
 * await sandbox.stop();
 * ```
 */
export class Sandbox {
  readonly rpcUrl: string
  readonly networkId: string
  readonly rootAccount: { id: string; secretKey: string }

  private process: ChildProcess | undefined
  private homeDir: string

  private constructor(
    rpcUrl: string,
    networkId: string,
    rootAccount: { id: string; secretKey: string },
    homeDir: string,
    childProcess: ChildProcess | undefined,
  ) {
    this.rpcUrl = rpcUrl
    this.networkId = networkId
    this.rootAccount = rootAccount
    this.homeDir = homeDir
    this.process = childProcess
  }

  /**
   * Start a new sandbox instance
   *
   * Downloads the sandbox binary if needed, initializes a temporary directory,
   * and starts the sandbox process.
   *
   * @param options - Optional configuration
   * @returns Promise resolving to a running Sandbox instance
   */
  static async start(options: SandboxOptions = {}): Promise<Sandbox> {
    const version = options.version ?? DEFAULT_VERSION
    const detached = options.detached ?? true

    // 1. Ensure binary is available
    const binaryPath = await ensureBinary(version)

    // 2. Create temporary home directory
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "near-sandbox-"))

    // 3. Initialize sandbox
    await runInit(binaryPath, homeDir)

    // 4. Read validator key
    const validatorKey = await loadValidatorKey(homeDir)
    const rootAccount = {
      id: validatorKey.account_id,
      secretKey: validatorKey.secret_key ?? validatorKey.private_key ?? "",
    }

    // 5. Start sandbox process
    const port = await findAvailablePort()
    const networkPort = port + 1
    const childProcess = spawn(
      binaryPath,
      [
        "--home",
        homeDir,
        "run",
        "--rpc-addr",
        `0.0.0.0:${port}`,
        "--network-addr",
        `0.0.0.0:${networkPort}`,
      ],
      {
        detached,
        stdio: detached ? "ignore" : "pipe",
      },
    )

    if (!childProcess.pid) {
      throw new Error("Failed to start sandbox: no PID")
    }

    if (detached) {
      childProcess.unref()
    }
    const rpcUrl = `http://127.0.0.1:${port}`

    // 6. Wait for RPC to be ready
    await waitForReady(rpcUrl)

    return new Sandbox(rpcUrl, "localnet", rootAccount, homeDir, childProcess)
  }

  /**
   * Stop the sandbox and clean up
   *
   * Kills the sandbox process and removes temporary files.
   */
  async stop(): Promise<void> {
    if (this.process?.pid) {
      const pid = this.process.pid

      try {
        // Try to kill process group first (for detached processes)
        process.kill(-pid, "SIGTERM")
        await sleep(100)
      } catch {
        // Try direct kill
        try {
          process.kill(pid, "SIGTERM")
          await sleep(100)
        } catch {
          // Try SIGKILL as last resort
          try {
            process.kill(pid, "SIGKILL")
          } catch {
            // Process already dead
          }
        }
      }

      this.process = undefined
    }

    // Clean up temporary directory
    try {
      await rm(this.homeDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }

  // ==================== Sandbox-specific RPC Methods ====================

  /**
   * Patch the state of accounts and contracts in the sandbox.
   *
   * This method allows you to directly modify blockchain state including:
   * - Account balances and storage
   * - Access keys
   * - Contract code
   * - Contract storage (key-value pairs)
   *
   * @param records - Array of state records to patch
   * @returns Promise resolving when the state has been patched
   *
   * @example
   * ```typescript
   * // Patch an account's balance
   * await sandbox.patchState([{
   *   Account: {
   *     account_id: "alice.test.near",
   *     account: {
   *       amount: "1000000000000000000000000000", // 1000 NEAR
   *       locked: "0",
   *       code_hash: "11111111111111111111111111111111",
   *       storage_usage: 100,
   *     }
   *   }
   * }])
   *
   * // Patch contract data
   * await sandbox.patchState([{
   *   Data: {
   *     account_id: "contract.test.near",
   *     data_key: btoa("STATE"), // base64 encoded key
   *     value: btoa(JSON.stringify({ count: 42 })), // base64 encoded value
   *   }
   * }])
   * ```
   *
   * @see https://docs.near.org/smart-contracts/testing/integration-test#patching-state
   */
  async patchState(records: StateRecord[]): Promise<void> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "patch-state",
        method: "sandbox_patch_state",
        params: { records },
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to patch state: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as { error?: { message: string } }
    if (data.error) {
      throw new Error(`Failed to patch state: ${data.error.message}`)
    }
  }

  /**
   * Fast-forward the blockchain by a number of blocks.
   *
   * This method advances the sandbox blockchain state by producing empty blocks,
   * which is useful for testing time-dependent contract logic without waiting
   * for real blocks to be produced.
   *
   * @param numBlocks - Number of blocks to advance (must be positive)
   * @returns Promise resolving when blocks have been produced
   *
   * @example
   * ```typescript
   * // Advance by 100 blocks
   * await sandbox.fastForward(100)
   *
   * // Test time-dependent logic
   * const sandbox = await Sandbox.start()
   * await sandbox.fastForward(1000) // Skip ahead
   * // Now test that time-locked funds are available, etc.
   * ```
   *
   * @see https://docs.near.org/smart-contracts/testing/integration-test#fast-forwarding
   */
  async fastForward(numBlocks: number): Promise<void> {
    if (numBlocks <= 0) {
      throw new Error("numBlocks must be a positive integer")
    }

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "fast-forward",
        method: "sandbox_fast_forward",
        params: { delta_height: numBlocks },
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fast forward: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as { error?: { message: string } }
    if (data.error) {
      throw new Error(`Failed to fast forward: ${data.error.message}`)
    }
  }

  /**
   * Dump the current state of the sandbox to a snapshot.
   *
   * This method saves the current blockchain state including all accounts,
   * access keys, contracts, and contract data. The snapshot can be used
   * to restore the state later with `restoreState()`.
   *
   * Note: This runs the sandbox's view-state dump-state command, which
   * requires stopping and restarting the sandbox process.
   *
   * @returns Promise resolving to the state snapshot
   *
   * @example
   * ```typescript
   * // Save state before running tests
   * const snapshot = await sandbox.dumpState()
   *
   * // Run test that modifies state
   * await near.call("contract.near", "increment", {})
   *
   * // Restore state for next test
   * await sandbox.restoreState(snapshot)
   * ```
   */
  async dumpState(): Promise<StateSnapshot> {
    // Get the binary path
    const binaryPath = await ensureBinary(DEFAULT_VERSION)

    // Run view-state dump-state command to get all state records
    await runCommand(binaryPath, this.homeDir, ["view-state", "dump-state"])

    // The command outputs to output.json in the home directory
    const outputPath = path.join(this.homeDir, "output.json")

    try {
      const data = await readFile(outputPath, "utf8")
      const parsed = JSON.parse(data) as { records: StateRecord[] }
      return {
        records: parsed.records || [],
        timestamp: Date.now(),
      }
    } catch {
      // If the command fails or file doesn't exist, return empty snapshot
      return {
        records: [],
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Restore the sandbox state from a previously saved snapshot.
   *
   * This method patches the blockchain state to match the snapshot,
   * effectively resetting it to a previous point in time. This is useful
   * for running multiple tests against the same initial state without
   * restarting the sandbox.
   *
   * @param snapshot - The state snapshot from `dumpState()`
   * @returns Promise resolving when the state has been restored
   *
   * @example
   * ```typescript
   * // Setup: Deploy contracts and create initial state
   * const near = new Near({ network: sandbox })
   * await near.call("contract.near", "initialize", { value: 0 })
   *
   * // Save snapshot
   * const snapshot = await sandbox.dumpState()
   *
   * // Test 1: Modifies state
   * await near.call("contract.near", "increment", {})
   *
   * // Reset for Test 2
   * await sandbox.restoreState(snapshot)
   *
   * // Test 2: Starts from same initial state
   * await near.call("contract.near", "decrement", {})
   * ```
   */
  async restoreState(snapshot: StateSnapshot): Promise<void> {
    await this.patchState(snapshot.records)
  }

  /**
   * Create a state snapshot by saving the current state to a file.
   *
   * This method is more comprehensive than `dumpState()` as it uses
   * the sandbox's built-in state dump functionality. However, it requires
   * stopping the sandbox process temporarily.
   *
   * @returns Promise resolving to the file path of the snapshot
   *
   * @example
   * ```typescript
   * const snapshotPath = await sandbox.saveSnapshot()
   * console.log(`Snapshot saved to: ${snapshotPath}`)
   * ```
   */
  async saveSnapshot(): Promise<string> {
    const snapshotDir = path.join(this.homeDir, "snapshots")
    await mkdir(snapshotDir, { recursive: true })

    const snapshotPath = path.join(snapshotDir, `snapshot-${Date.now()}.json`)

    // Get the binary path (need to look it up from the current installation)
    const binaryPath = await ensureBinary(DEFAULT_VERSION)

    // Run view-state dump-state command
    await runCommand(binaryPath, this.homeDir, ["view-state", "dump-state"])

    // The command outputs to output.json in the home directory
    const outputPath = path.join(this.homeDir, "output.json")
    await copyFile(outputPath, snapshotPath)

    return snapshotPath
  }

  /**
   * Load a state snapshot from a file.
   *
   * @param snapshotPath - Path to the snapshot file
   * @returns Promise resolving to the state snapshot
   */
  async loadSnapshot(snapshotPath: string): Promise<StateSnapshot> {
    const data = await readFile(snapshotPath, "utf8")
    const parsed = JSON.parse(data) as { records: StateRecord[] }
    return {
      records: parsed.records,
      timestamp: Date.now(),
    }
  }

  /**
   * Restart the sandbox with a modified genesis state.
   *
   * This is the most comprehensive way to reset state, as it fully
   * restarts the sandbox process with the specified initial state.
   * This is useful for running isolated test suites.
   *
   * @param snapshot - Optional state snapshot to restore on restart
   * @returns Promise resolving when the sandbox is ready
   *
   * @example
   * ```typescript
   * // Save initial state after setup
   * const snapshot = await sandbox.saveSnapshot()
   *
   * // Run tests...
   *
   * // Reset to clean state for next test suite
   * await sandbox.restart(snapshot)
   * ```
   */
  async restart(snapshot?: StateSnapshot): Promise<void> {
    if (!this.process?.pid) {
      throw new Error("Sandbox is not running")
    }

    const pid = this.process.pid
    const port = new URL(this.rpcUrl).port

    // Stop the current process
    try {
      process.kill(-pid, "SIGTERM")
      await sleep(500)
    } catch {
      try {
        process.kill(pid, "SIGTERM")
        await sleep(500)
      } catch {
        // Process might already be dead
      }
    }

    this.process = undefined

    // If we have a snapshot, we need to modify the genesis file
    if (snapshot && snapshot.records.length > 0) {
      const genesisPath = path.join(this.homeDir, "genesis.json")
      const genesisData = await readFile(genesisPath, "utf8")
      const genesis = JSON.parse(genesisData) as { records?: StateRecord[] }

      // Append snapshot records to genesis records
      genesis.records = [...(genesis.records || []), ...snapshot.records]

      await writeFile(genesisPath, JSON.stringify(genesis, null, 2))
    }

    // Clean up data directory
    const dataDir = path.join(this.homeDir, "data")
    await rm(dataDir, { recursive: true, force: true })

    // Get binary path
    const binaryPath = await ensureBinary(DEFAULT_VERSION)

    // Restart the sandbox
    const networkPort = Number.parseInt(port, 10) + 1
    const childProcess = spawn(
      binaryPath,
      [
        "--home",
        this.homeDir,
        "run",
        "--rpc-addr",
        `0.0.0.0:${port}`,
        "--network-addr",
        `0.0.0.0:${networkPort}`,
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    )

    if (!childProcess.pid) {
      throw new Error("Failed to restart sandbox: no PID")
    }

    childProcess.unref()
    this.process = childProcess

    // Wait for RPC to be ready
    await waitForReady(this.rpcUrl)
  }
}

// ==================== Helper Functions ====================

/**
 * Get platform identifier for downloading correct binary.
 * @internal
 */
function getPlatformId(): PlatformInfo {
  const system = os.platform()
  const arch = os.arch()

  const platform = system === "darwin" ? "Darwin" : "Linux"
  const normalizedArch = arch === "x64" ? "x86_64" : arch

  if (!["x86_64", "arm64"].includes(normalizedArch)) {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  if (system !== "darwin" && system !== "linux") {
    throw new Error(`Unsupported platform: ${system}`)
  }

  return { system: platform, arch: normalizedArch }
}

/**
 * Get directory for storing sandbox binaries.
 * @internal
 */
function getBinaryDir(): string {
  const dir = path.join(os.homedir(), ".near-kit", "sandbox", "bin")
  return dir
}

/**
 * Download and extract sandbox binary.
 * @internal
 */
async function downloadBinary(version: string): Promise<string> {
  const { system, arch } = getPlatformId()
  const destDir = getBinaryDir()
  const filename = `${BINARY_NAME}-${version}`
  const dest = path.join(destDir, filename)

  // Return if already exists
  if (fs.existsSync(dest)) {
    return dest
  }

  const url = `${DOWNLOAD_BASE}/${system}-${arch}/${version}/${ARCHIVE_NAME}`
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "near-sandbox-download-"))

  try {
    const archivePath = path.join(tmpDir, ARCHIVE_NAME)

    // Download with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(
          `Download failed: ${response.status} ${response.statusText}`,
        )
      }

      if (!response.body) {
        throw new Error("Response body is null")
      }

      const stream = fs.createWriteStream(archivePath)
      // Convert DOM ReadableStream to Node.js ReadableStream
      await pipeline(
        Readable.fromWeb(response.body as unknown as WebReadableStream),
        stream,
      )
    } finally {
      clearTimeout(timeout)
    }

    // Extract archive (strip=1 removes top-level directory)
    await tar.x({ file: archivePath, cwd: tmpDir, strip: 1 })

    const extracted = path.join(tmpDir, BINARY_NAME)
    if (!fs.existsSync(extracted)) {
      throw new Error(`Binary ${BINARY_NAME} not found in archive`)
    }

    // Move to final location and make executable
    await mkdir(path.dirname(dest), { recursive: true })
    await fs.promises.rename(extracted, dest)
    await fs.promises.chmod(dest, 0o755)

    return dest
  } catch (error) {
    throw new Error(`Failed to download binary from ${url}: ${error}`)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Ensure binary is available and return its path.
 * @internal
 */
async function ensureBinary(version: string): Promise<string> {
  return await downloadBinary(version)
}

/**
 * Run sandbox init command.
 * @internal
 */
async function runInit(binaryPath: string, homeDir: string): Promise<void> {
  const args = ["--home", homeDir, "init", "--chain-id", "localnet"]

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: "pipe" })
    let stderr = ""

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        // Provide helpful error message for common issues
        let errorMsg = `Sandbox init failed with code ${code}: ${stderr}`

        if (stderr.includes("file descriptor limit")) {
          errorMsg +=
            "\n\n" +
            "The sandbox requires at least 65,535 file descriptors.\n" +
            "Current limit can be checked with: ulimit -n\n\n" +
            "To fix on Linux, add to /etc/security/limits.conf:\n" +
            "  * soft nofile 65535\n" +
            "  * hard nofile 65535\n\n" +
            "To fix on macOS:\n" +
            "  sudo launchctl limit maxfiles 65536 200000\n\n" +
            "For Docker, add: --ulimit nofile=65535:65535\n\n" +
            "See: https://github.com/r-near/near-kit/blob/main/src/sandbox/README.md"
        }

        reject(new Error(errorMsg))
      }
    })

    child.on("error", reject)
  })
}

/**
 * Run a sandbox command (like view-state dump-state).
 * @internal
 */
async function runCommand(
  binaryPath: string,
  homeDir: string,
  args: string[],
): Promise<string> {
  const fullArgs = ["--home", homeDir, ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, fullArgs, { stdio: "pipe" })
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Sandbox command failed with code ${code}: ${stderr}`))
      }
    })

    child.on("error", reject)
  })
}

/**
 * Load validator key from sandbox home directory.
 * @internal
 */
async function loadValidatorKey(homeDir: string): Promise<ValidatorKey> {
  const keyPath = path.join(homeDir, "validator_key.json")

  try {
    const data = await readFile(keyPath, "utf8")
    return JSON.parse(data) as ValidatorKey
  } catch (error) {
    throw new Error(`Failed to read validator key from ${keyPath}: ${error}`)
  }
}

/**
 * Find an available port by letting the OS choose.
 * @internal
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.on("error", reject)

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get port"))
        return
      }

      const port = address.port
      server.close(() => {
        resolve(port)
      })
    })
  })
}

/**
 * Ping sandbox RPC endpoint to check if it's ready.
 * @internal
 */
async function pingRpc(url: string, timeoutMs = 1000): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "status",
        method: "status",
        params: [],
      }),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Wait for sandbox to be ready.
 * @internal
 */
async function waitForReady(
  rpcUrl: string,
  timeout = STARTUP_TIMEOUT,
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await pingRpc(rpcUrl)) {
      return
    }
    await sleep(500)
  }

  throw new Error(`Sandbox failed to start within ${timeout}ms`)
}

/**
 * Sleep helper.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
