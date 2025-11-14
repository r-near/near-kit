/**
 * Key management module
 */

export * from "./credential-schemas.js"
export * from "./file-keystore.js"
export * from "./in-memory-keystore.js"

// NativeKeyStore contains native Node.js dependencies and cannot be bundled for browsers
// For Node.js/Bun environments, import directly:
// import { NativeKeyStore } from "near-kit/dist/keys/native-keystore.js"
//
// For browser environments, use InMemoryKeyStore instead
// export * from "./native-keystore.js"
