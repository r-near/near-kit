/**
 * Unit tests for sandbox binary platform identification
 *
 * The download URL is `${DOWNLOAD_BASE}/${system}-${arch}/${version}/near-sandbox.tar.gz`,
 * so system/arch must match the S3 paths exactly. Notably, Linux ARM builds are
 * published under "aarch64" while Darwin ARM builds use "arm64".
 */

import { describe, expect, test } from "vitest"
import { getPlatformId } from "../../src/sandbox/sandbox.js"

describe("getPlatformId", () => {
  test("maps linux x64 to Linux-x86_64", () => {
    expect(getPlatformId("linux", "x64")).toEqual({
      system: "Linux",
      arch: "x86_64",
    })
  })

  test("maps linux arm64 to Linux-aarch64", () => {
    expect(getPlatformId("linux", "arm64")).toEqual({
      system: "Linux",
      arch: "aarch64",
    })
  })

  test("maps darwin x64 to Darwin-x86_64", () => {
    expect(getPlatformId("darwin", "x64")).toEqual({
      system: "Darwin",
      arch: "x86_64",
    })
  })

  test("maps darwin arm64 to Darwin-arm64", () => {
    expect(getPlatformId("darwin", "arm64")).toEqual({
      system: "Darwin",
      arch: "arm64",
    })
  })

  test("throws on unsupported platform", () => {
    expect(() => getPlatformId("win32", "x64")).toThrow(
      "Unsupported platform: win32",
    )
  })

  test("throws on unsupported architecture", () => {
    expect(() => getPlatformId("linux", "ia32")).toThrow(
      "Unsupported architecture: ia32",
    )
  })

  test("defaults to the current process platform", () => {
    // On any supported dev/CI machine this should resolve without throwing
    const { system, arch } = getPlatformId()
    expect(["Linux", "Darwin"]).toContain(system)
    expect(["x86_64", "aarch64", "arm64"]).toContain(arch)
  })
})
