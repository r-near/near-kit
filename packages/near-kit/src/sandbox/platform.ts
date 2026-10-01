import os from "node:os"

interface PlatformInfo {
  system: string
  arch: string
}

export function getPlatformId(
  system: string = os.platform(),
  arch: string = os.arch(),
): PlatformInfo {
  if (system !== "darwin" && system !== "linux") {
    throw new Error(`Unsupported platform: ${system}`)
  }

  let normalizedArch: string
  if (arch === "x64") {
    normalizedArch = "x86_64"
  } else if (arch === "arm64") {
    // S3 publishes Linux ARM builds under "aarch64" but Darwin under "arm64"
    normalizedArch = system === "linux" ? "aarch64" : "arm64"
  } else {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  return {
    system: system === "darwin" ? "Darwin" : "Linux",
    arch: normalizedArch,
  }
}
