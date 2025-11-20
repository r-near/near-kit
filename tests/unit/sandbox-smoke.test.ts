import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

describe("Sandbox helpers", () => {
  it("loadValidatorKey throws for missing file", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "sandbox-missing-"))
    const sandboxModule = await import("../../src/sandbox/sandbox.js")
    const loadValidatorKey = (sandboxModule as any)._internal
      .loadValidatorKey as (home: string) => Promise<unknown>

    await expect(loadValidatorKey(tmp)).rejects.toThrow("validator_key.json")
    await rm(tmp, { recursive: true, force: true })
  })

  it("findAvailablePort rejects when address is unavailable", async () => {
    vi.doMock("node:net", () => ({
      createServer: () => {
        return {
          on: () => undefined,
          listen: (_port: number, _host: string, cb: () => void) => cb(),
          address: () => null,
          close: (cb: () => void) => cb(),
        }
      },
    }))

    vi.resetModules()
    const sandboxModule = await import("../../src/sandbox/sandbox.js")
    const findAvailablePort = (sandboxModule as any)._internal
      .findAvailablePort as () => Promise<number>

    await expect(findAvailablePort()).rejects.toThrow("Failed to get port")

    vi.doUnmock("node:net")
    vi.resetModules()
  })

  it("waitForReady times out when RPC never responds", async () => {
    const sandboxModule = await import("../../src/sandbox/sandbox.js")
    const waitForReady = (sandboxModule as any)._internal.waitForReady as (
      url: string,
      timeout?: number,
    ) => Promise<void>
    const pingSpy = vi
      .spyOn((sandboxModule as any)._internal, "pingRpc")
      .mockResolvedValue(false)

    await expect(waitForReady("http://localhost:0", 5)).rejects.toThrow(
      "failed to start",
    )

    pingSpy.mockRestore()
  })
})
