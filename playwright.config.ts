import { defineConfig, devices } from "@playwright/test"

const reactVersions = [
  { version: "18", port: 4173 },
  { version: "19", port: 4174 },
]
const browsers = [
  { name: "chromium", device: devices["Desktop Chrome"] },
  { name: "firefox", device: devices["Desktop Firefox"] },
  { name: "webkit", device: devices["Desktop Safari"] },
]
const isCI = Boolean(process.env["CI"])

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  failOnFlakyTests: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : 2,
  timeout: 30_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 5_000 },
  outputDir: "test-results/browser",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: reactVersions.flatMap(({ version, port }) =>
    browsers.map(({ name, device }) => ({
      name: `${name}-react${version}`,
      use: { ...device, baseURL: `http://127.0.0.1:${port}` },
    })),
  ),
  webServer: reactVersions.map(({ version, port }) => ({
    command: `bun run test:browser:serve --host 127.0.0.1 --port ${port} --strictPort`,
    env: { REACT_VERSION: version },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  })),
})
