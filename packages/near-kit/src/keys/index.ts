/**
 * Key management module.
 *
 * @remarks
 * Includes {@link InMemoryKeyStore} for ephemeral keys, {@link RotatingKeyStore} for
 * high-throughput concurrent transactions, and credential schemas for working
 * with existing NEAR tooling.
 *
 * For Node.js/Bun environments, additional keystores are available via subpath imports:
 * - `FileKeyStore` for NEAR-CLI compatible disk storage: `import { FileKeyStore } from "near-kit/keys/file"`
 * - `NativeKeyStore` for OS keyring integration: `import { NativeKeyStore } from "near-kit/keys/native"`
 */
export * from "./credential-schemas.js"
export * from "./in-memory-keystore.js"
export * from "./rotating-keystore.js"

// FileKeyStore and NativeKeyStore contain Node.js dependencies and cannot be bundled for browsers.
// For browser environments, use InMemoryKeyStore instead.
