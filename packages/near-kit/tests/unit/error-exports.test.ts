/**
 * The error classes the docs import from "near-kit" must be exported from the
 * package entry point, or `instanceof` checks against them can't be written.
 */

import { describe, expect, test } from "vitest"
import * as nearKit from "../../src/index.js"

describe("public error exports", () => {
  test.each([
    "ExternalCallRefusedError",
    "ExternalCallTimeoutError",
    "InvalidNonceError",
    "InvalidStateInitError",
    "InvalidTransactionError",
    "TimeoutError",
    "RemovedProtocolFeatureError",
    "ReservedMethodNameError",
    "ShardUnavailableError",
    "TransferToUniversalAccountNotAllowedError",
    "UninitializedAccountError",
    "UnknownTransactionError",
  ])("exports %s as a NearError subclass", (name) => {
    const ErrorClass = (nearKit as Record<string, unknown>)[name]
    expect(typeof ErrorClass).toBe("function")
    expect((ErrorClass as { prototype: unknown }).prototype).toBeInstanceOf(
      nearKit.NearError,
    )
  })
})
