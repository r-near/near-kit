import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    api: {
      port: 41204,
    },
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts", // barrel files
        "src/**/types.ts",
        "tests/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    testTimeout: 60000,
  },
})
