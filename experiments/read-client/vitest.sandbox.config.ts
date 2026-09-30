import { defineConfig } from "vitest/config"
export default defineConfig({ test: { include: ["test/sandbox/**/*.spec.ts"], testTimeout: 30_000 } })
