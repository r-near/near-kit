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

const DEFAULT_VERSION = "2.10.5"
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
 * Default code hash for accounts without deployed contract code.
 * This is a base58-encoded sha256 hash of an empty byte array.
 */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111"

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
   * Path to a local near-sandbox binary. If provided, skips downloading.
   * Falls back to NEAR_SANDBOX_BIN_PATH environment variable if not set.
   */
  binaryPath?: string
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
  private binaryPath: string

  private constructor(
    rpcUrl: string,
    networkId: string,
    rootAccount: { id: string; secretKey: string },
    homeDir: string,
    childProcess: ChildProcess | undefined,
    binaryPath: string,
  ) {
    this.rpcUrl = rpcUrl
    this.networkId = networkId
    this.rootAccount = rootAccount
    this.homeDir = homeDir
    this.process = childProcess
    this.binaryPath = binaryPath
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
    const binaryPath = await ensureBinary(version, options.binaryPath)

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
    // Find two separate available ports to avoid conflicts when running in parallel
    const port = await findAvailablePort()
    const networkPort = await findAvailablePort()
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

    return new Sandbox(
      rpcUrl,
      "localnet",
      rootAccount,
      homeDir,
      childProcess,
      binaryPath,
    )
  }

  /**
   * Stop the sandbox and clean up
   *
   * Kills the sandbox process and removes temporary files.
   */
  async stop(): Promise<void> {
    if (this.process?.pid) {
      await killProcess(this.process)
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
   * Allows direct modification of blockchain state including account balances,
   * access keys, contract code, and contract storage.
   *
   * Note: The patched state is applied during the next block's processing.
   * This method waits for that block to be produced before returning to
   * ensure subsequent reads see the updated state.
   *
   * @param records - Array of state records to patch
   *
   * @example
   * ```typescript
   * await sandbox.patchState([{
   *   Account: {
   *     account_id: "alice.test.near",
   *     account: {
   *       amount: "1000000000000000000000000000",
   *       locked: "0",
   *       code_hash: EMPTY_CODE_HASH,
   *       storage_usage: 100,
   *     }
   *   }
   * }])
   * ```
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

    // sandbox_patch_state returns when the patch is dequeued from memory,
    // but before the block containing the patch is fully processed and
    // committed to RocksDB. Wait for a new block to ensure the patched
    // state is visible to subsequent queries.
    await this.waitForNextBlock()
  }

  /**
   * Fast-forward the blockchain by a number of blocks.
   *
   * Advances the sandbox by producing empty blocks, useful for testing
   * time-dependent contract logic without waiting for real blocks.
   *
   * @param numBlocks - Number of blocks to advance (must be positive)
   *
   * @example
   * ```typescript
   * await sandbox.fastForward(100)
   * ```
   */
  async fastForward(numBlocks: number): Promise<void> {
    if (numBlocks <= 0) {
      throw new Error("numBlocks must be a positive integer")
    }

    const heightBefore = await this.getBlockHeight()

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

    // The RPC may return before all blocks are fully produced.
    // Poll until the block height reaches the target.
    const targetHeight = heightBefore + numBlocks
    const start = Date.now()
    const timeoutMs = Math.max(30000, numBlocks * 100)

    while (Date.now() - start < timeoutMs) {
      const height = await this.getBlockHeight()
      if (height >= targetHeight) {
        return
      }
      await sleep(200)
    }

    const finalHeight = await this.getBlockHeight()
    if (finalHeight < targetHeight) {
      throw new Error(
        `Fast forward did not reach target height ${targetHeight} (currently at ${finalHeight})`,
      )
    }
  }

  /**
   * Dump the current state of the sandbox to a snapshot.
   *
   * Runs the sandbox binary's `view-state dump-state` command which reads
   * state from RocksDB in read-only mode. The snapshot includes all accounts,
   * access keys, contracts, and contract data.
   *
   * @returns The state snapshot
   *
   * @example
   * ```typescript
   * const snapshot = await sandbox.dumpState()
   * // ... modify state ...
   * await sandbox.restoreState(snapshot)
   * ```
   */
  async dumpState(): Promise<StateSnapshot> {
    // Wait for a new block so all pending state changes are committed to
    // RocksDB before the dump process opens it in read-only mode.
    await this.waitForNextBlock()

    await runCommand(this.binaryPath, this.homeDir, [
      "view-state",
      "dump-state",
    ])

    const outputPath = path.join(this.homeDir, "output.json")

    try {
      const data = await readFile(outputPath, "utf8")
      const parsed = JSON.parse(data) as { records: StateRecord[] }
      return {
        records: parsed.records || [],
        timestamp: Date.now(),
      }
    } catch (error) {
      console.warn(
        `Warning: Failed to read state dump from ${outputPath}: ${error instanceof Error ? error.message : error}`,
      )
      return {
        records: [],
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Restore the sandbox state from a previously saved snapshot.
   *
   * Patches the blockchain state to match the snapshot. Useful for
   * running multiple tests against the same initial state.
   *
   * @param snapshot - The state snapshot from `dumpState()`
   */
  async restoreState(snapshot: StateSnapshot): Promise<void> {
    await this.patchState(snapshot.records)
  }

  /**
   * Save a state snapshot to a file.
   *
   * @returns Path to the saved snapshot file
   */
  async saveSnapshot(): Promise<string> {
    const snapshotDir = path.join(this.homeDir, "snapshots")
    await mkdir(snapshotDir, { recursive: true })

    const snapshotPath = path.join(snapshotDir, `snapshot-${Date.now()}.json`)

    // Wait for a new block so all pending state changes are committed
    await this.waitForNextBlock()

    await runCommand(this.binaryPath, this.homeDir, [
      "view-state",
      "dump-state",
    ])

    const outputPath = path.join(this.homeDir, "output.json")
    await copyFile(outputPath, snapshotPath)

    return snapshotPath
  }

  /**
   * Load a state snapshot from a file.
   *
   * @param snapshotPath - Path to the snapshot file
   * @returns The loaded state snapshot
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
   * Restart the sandbox, optionally with modified genesis state.
   *
   * Stops the process, optionally appends snapshot records to genesis,
   * clears the data directory, and restarts. Block height resets to 0.
   *
   * @param snapshot - Optional state snapshot to include in genesis
   */
  async restart(snapshot?: StateSnapshot): Promise<void> {
    if (!this.process?.pid) {
      throw new Error("Sandbox is not running")
    }

    const port = new URL(this.rpcUrl).port

    // Kill the process and wait for it to fully exit before touching the data dir
    await killProcess(this.process)
    this.process = undefined

    // Merge snapshot records into genesis if provided
    if (snapshot && snapshot.records.length > 0) {
      const genesisPath = path.join(this.homeDir, "genesis.json")
      const genesisData = await readFile(genesisPath, "utf8")
      const genesis = JSON.parse(genesisData) as {
        records?: StateRecord[]
        total_supply?: string
      }

      const existingRecords = genesis.records || []

      // Build a map of snapshot records keyed by account_id for deduplication.
      // Snapshot records override any existing genesis record for the same account.
      const snapshotAccountMap = new Map<string, StateRecord>()
      for (const record of snapshot.records) {
        const accountId =
          record.Account?.account_id ??
          record.AccessKey?.account_id ??
          record.Contract?.account_id ??
          record.Data?.account_id
        if (accountId) {
          snapshotAccountMap.set(
            `${accountId}:${Object.keys(record)[0]}`,
            record,
          )
        }
      }

      // Filter out existing records that would be duplicated by the snapshot
      const filteredExisting = existingRecords.filter((record) => {
        const accountId =
          record.Account?.account_id ??
          record.AccessKey?.account_id ??
          record.Contract?.account_id ??
          record.Data?.account_id
        if (!accountId) return true
        const key = `${accountId}:${Object.keys(record)[0]}`
        return !snapshotAccountMap.has(key)
      })

      genesis.records = [...filteredExisting, ...snapshot.records]

      // Recalculate total supply from all Account records
      let totalSupply = 0n
      for (const record of genesis.records) {
        if (record.Account) {
          totalSupply += BigInt(record.Account.account.amount)
          totalSupply += BigInt(record.Account.account.locked)
        }
      }
      genesis.total_supply = totalSupply.toString()

      await writeFile(genesisPath, JSON.stringify(genesis, null, 2))
    }

    // Clean up data directory so the node starts fresh
    const dataDir = path.join(this.homeDir, "data")
    await rm(dataDir, { recursive: true, force: true })

    // Restart with the same ports
    const networkPort = await findAvailablePort()
    const childProcess = spawn(
      this.binaryPath,
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
        stdio: ["ignore", "ignore", "pipe"],
      },
    )

    if (!childProcess.pid) {
      throw new Error("Failed to restart sandbox: no PID")
    }

    // Capture stderr for error reporting if startup fails
    let stderrOutput = ""
    childProcess.stderr?.on("data", (data) => {
      stderrOutput += data.toString()
    })

    childProcess.unref()
    this.process = childProcess

    try {
      await waitForReady(this.rpcUrl)
    } catch (error) {
      // Include stderr in the error message for debugging
      if (stderrOutput) {
        throw new Error(
          `${error instanceof Error ? error.message : error}\nSandbox stderr:\n${stderrOutput.slice(-2000)}`,
        )
      }
      throw error
    }
  }

  /**
   * Wait for the next block to be produced.
   * Used internally to ensure state changes are committed to RocksDB.
   */
  private async waitForNextBlock(timeoutMs = 10000): Promise<void> {
    const currentHeight = await this.getBlockHeight()
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      await sleep(100)
      const height = await this.getBlockHeight()
      if (height > currentHeight) {
        return
      }
    }

    throw new Error(
      `Timed out waiting for next block after ${timeoutMs}ms (stuck at height ${currentHeight})`,
    )
  }

  private async getBlockHeight(): Promise<number> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "status",
        method: "status",
        params: [],
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.status}`)
    }

    const data = (await response.json()) as {
      result?: { sync_info?: { latest_block_height?: number } }
    }
    return data.result?.sync_info?.latest_block_height ?? 0
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
async function ensureBinary(
  version: string,
  explicitPath?: string,
): Promise<string> {
  // 1. Explicit path from options
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Sandbox binary not found: ${explicitPath}`)
    }
    return explicitPath
  }

  // 2. Environment variable
  const envPath = process.env["NEAR_SANDBOX_BIN_PATH"]
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(`NEAR_SANDBOX_BIN_PATH binary not found: ${envPath}`)
    }
    return envPath
  }

  // 3. Download
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
 * Run a sandbox CLI command (e.g. view-state dump-state).
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

/**
 * Kill a sandbox child process and wait for it to fully exit.
 *
 * Sends SIGTERM to the process group first, then SIGKILL if it doesn't
 * exit within 2 seconds. Waits for the process to actually exit before
 * returning, ensuring file handles (e.g. RocksDB) are released.
 * @internal
 */
async function killProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) return

  const exitPromise = new Promise<void>((resolve) => {
    child.on("exit", () => resolve())
    child.on("error", () => resolve())
  })

  // Try SIGTERM to process group first (graceful shutdown)
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already dead
      return
    }
  }

  // Wait up to 2s for graceful exit, then SIGKILL
  const timeout = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Already dead
      }
    }
  }, 2000)

  await exitPromise
  clearTimeout(timeout)
}
