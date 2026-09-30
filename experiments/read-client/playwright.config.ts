import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "test/browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4177", trace: "retain-on-failure" },
  webServer: { command: "node scripts/browser-server.mjs", url: "http://127.0.0.1:4177", reuseExistingServer: false },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
})
