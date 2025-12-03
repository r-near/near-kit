/**
 * Key management module.
 *
 * @remarks
 * Includes {@link InMemoryKeyStore} for ephemeral keys, {@link RotatingKeyStore} for
 * high-throughput concurrent transactions, and credential schemas for working
 * with existing NEAR tooling.
 */
export * from "./credential-schemas.js"
export * from "./in-memory-keystore.js"
export * from "./rotating-keystore.js"

// FileKeyStore and NativeKeyStore contain Node.js dependencies and cannot be bundled for browsers.
// For Node.js/Bun environments, import directly:
//   import { FileKeyStore } from "near-kit/keys/file"
//   import { NativeKeyStore } from "near-kit/keys/native"
