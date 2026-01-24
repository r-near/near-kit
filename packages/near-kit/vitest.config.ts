import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    api: {
      port: 41204,
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    testTimeout: 60000,
  },
})
