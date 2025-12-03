/**
 * NEAR Sandbox - Local testing environment
 *
 * Simple, explicit API for running a local NEAR node for testing.
 */

import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import fs from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"
import * as tar from "tar"

const DEFAULT_VERSION = "2.10-release"
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
