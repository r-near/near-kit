/**
 * Unit tests for RPC error handler
 * Tests the parseQueryError function to ensure proper error type detection
 */

import { describe, expect, test } from "vitest"
import {
  parseQueryError,
  parseRpcError,
} from "../../src/core/rpc/rpc-error-handler.js"
import {
  AccessKeyDoesNotExistError,
  FunctionCallError,
  GlobalContractNotFoundError,
  NetworkError,
} from "../../src/errors/index.js"

describe("parseQueryError", () => {
  test("should throw FunctionCallError for contract method errors containing 'does not exist'", () => {
    const result = {
      error:
        "wasm execution failed with error: FunctionCallError(MethodResolveError(MethodNotFound))",
    }

    expect(() =>
      parseQueryError(result, {
        contractId: "wrap.near",
        methodName: "nonexistent_method",
      }),
    ).toThrow(FunctionCallError)

    try {
      parseQueryError(result, {
        contractId: "wrap.near",
        methodName: "nonexistent_method",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(FunctionCallError)
      const funcError = error as FunctionCallError
      expect(funcError.contractId).toBe("wrap.near")
      expect(funcError.methodName).toBe("nonexistent_method")
      expect(funcError.code).toBe("FUNCTION_CALL_ERROR")
    }
  })

  test("should throw FunctionCallError for 'Method X does not exist' error message", () => {
    const result = {
      error: "Method get_token does not exist",
    }

    expect(() =>
      parseQueryError(result, {
        contractId: "token.near",
        methodName: "get_token",
      }),
    ).toThrow(FunctionCallError)

    try {
      parseQueryError(result, {
        contractId: "token.near",
        methodName: "get_token",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(FunctionCallError)
      const funcError = error as FunctionCallError
      expect(funcError.contractId).toBe("token.near")
      expect(funcError.methodName).toBe("get_token")
      expect(funcError.panic).toBe("Method get_token does not exist")
    }
  })

  test("should throw AccessKeyDoesNotExistError for access key queries with 'does not exist'", () => {
    const result = {
      error:
        "access key ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa does not exist",
    }

    expect(() =>
      parseQueryError(result, {
        accountId: "test.near",
        publicKey: "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
      }),
    ).toThrow(AccessKeyDoesNotExistError)

    try {
      parseQueryError(result, {
        accountId: "test.near",
        publicKey: "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
      const keyError = error as AccessKeyDoesNotExistError
      expect(keyError.accountId).toBe("test.near")
      expect(keyError.publicKey).toBe(
        "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
      )
      expect(keyError.code).toBe("ACCESS_KEY_NOT_FOUND")
    }
  })

  test("should throw AccessKeyDoesNotExistError when only accountId is in context", () => {
    const result = {
      error: "access key does not exist while viewing",
    }

    expect(() =>
      parseQueryError(result, {
        accountId: "test.near",
      }),
    ).toThrow(AccessKeyDoesNotExistError)

    try {
      parseQueryError(result, {
        accountId: "test.near",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
      const keyError = error as AccessKeyDoesNotExistError
      expect(keyError.accountId).toBe("test.near")
      expect(keyError.publicKey).toBe("unknown")
    }
  })

  test("should throw AccessKeyDoesNotExistError when only publicKey is in context", () => {
    const result = {
      error: "access key does not exist while viewing",
    }

    expect(() =>
      parseQueryError(result, {
        publicKey: "ed25519:ABC123",
      }),
    ).toThrow(AccessKeyDoesNotExistError)

    try {
      parseQueryError(result, {
        publicKey: "ed25519:ABC123",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
      const keyError = error as AccessKeyDoesNotExistError
      expect(keyError.accountId).toBe("unknown")
      expect(keyError.publicKey).toBe("ed25519:ABC123")
    }
  })

  test("should throw NetworkError for generic query errors without context", () => {
    const result = {
      error: "Some random query error",
    }

    expect(() => parseQueryError(result, {})).toThrow(NetworkError)

    try {
      parseQueryError(result, {})
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError)
      const netError = error as NetworkError
      expect(netError.message).toContain("Query error")
      expect(netError.message).toContain("Some random query error")
    }
  })

  test("should throw NetworkError (not AccessKeyDoesNotExistError) for 'does not exist' without access-key context", () => {
    // This is the view_state case: a missing account/contract must surface as a
    // generic query error, not be misclassified as an access-key error.
    const result = {
      error: "account some.near does not exist while viewing",
    }

    expect(() => parseQueryError(result)).toThrow(NetworkError)
    expect(() => parseQueryError(result)).not.toThrow(
      AccessKeyDoesNotExistError,
    )
  })

  test("should throw NetworkError when access key error lacks 'does not exist' substring", () => {
    const result = {
      error: "Permission denied for access key",
    }

    expect(() =>
      parseQueryError(result, {
        accountId: "test.near",
        publicKey: "ed25519:ABC123",
      }),
    ).toThrow(NetworkError)

    try {
      parseQueryError(result, {
        accountId: "test.near",
        publicKey: "ed25519:ABC123",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError)
      const netError = error as NetworkError
      expect(netError.message).toContain("Permission denied")
    }
  })

  test("should throw FunctionCallError for any error with contractId context", () => {
    const result = {
      error: "Contract execution error: out of gas",
    }

    expect(() =>
      parseQueryError(result, {
        contractId: "contract.near",
        methodName: "expensive_method",
      }),
    ).toThrow(FunctionCallError)

    try {
      parseQueryError(result, {
        contractId: "contract.near",
        methodName: "expensive_method",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(FunctionCallError)
      const funcError = error as FunctionCallError
      expect(funcError.contractId).toBe("contract.near")
      expect(funcError.methodName).toBe("expensive_method")
      expect(funcError.panic).toContain("out of gas")
    }
  })

  test("should not throw when result has no error field", () => {
    const result = {
      success: true,
      data: "some data",
    }

    expect(() => parseQueryError(result, {})).not.toThrow()
  })

  test("should not throw when result is null", () => {
    expect(() => parseQueryError(null, {})).not.toThrow()
  })

  test("should not throw when result is undefined", () => {
    expect(() => parseQueryError(undefined, {})).not.toThrow()
  })

  test("should prioritize contractId context over 'does not exist' message", () => {
    // This is the regression test: ensure contractId takes precedence
    const result = {
      error: "MethodNotFound: method does not exist on the contract",
    }

    expect(() =>
      parseQueryError(result, {
        contractId: "contract.near",
        methodName: "missing_method",
      }),
    ).toThrow(FunctionCallError)

    // Should NOT throw AccessKeyDoesNotExistError even though message contains "does not exist"
    expect(() =>
      parseQueryError(result, {
        contractId: "contract.near",
        methodName: "missing_method",
      }),
    ).not.toThrow(AccessKeyDoesNotExistError)
  })
})

describe("parseRpcError - NO_GLOBAL_CONTRACT_CODE", () => {
  const noGlobalContractError = (identifier?: unknown) => ({
    name: "HANDLER_ERROR",
    code: -32000,
    message: "The global contract code is not available",
    cause: {
      name: "NO_GLOBAL_CONTRACT_CODE",
      ...(identifier !== undefined ? { info: { identifier } } : {}),
    },
  })

  test("should parse the current (nearcore >= 2.12) identifier shapes", () => {
    try {
      parseRpcError(noGlobalContractError({ hash: "9wa3Pn2XSFkQ4nWpq" }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalContractNotFoundError)
      expect((error as GlobalContractNotFoundError).identifier).toEqual({
        codeHash: "9wa3Pn2XSFkQ4nWpq",
      })
      expect((error as GlobalContractNotFoundError).code).toBe(
        "NO_GLOBAL_CONTRACT_CODE",
      )
    }

    try {
      parseRpcError(noGlobalContractError({ account_id: "publisher.near" }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalContractNotFoundError)
      expect((error as GlobalContractNotFoundError).identifier).toEqual({
        accountId: "publisher.near",
      })
    }
  })

  test("should parse the legacy (pre-2.12) identifier shapes", () => {
    // nearcore < 2.12 serialized GlobalContractIdentifier with PascalCase
    // variant names (renamed in nearcore#15539).
    try {
      parseRpcError(noGlobalContractError({ CodeHash: "9wa3Pn2XSFkQ4nWpq" }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalContractNotFoundError)
      expect((error as GlobalContractNotFoundError).identifier).toEqual({
        codeHash: "9wa3Pn2XSFkQ4nWpq",
      })
    }

    try {
      parseRpcError(noGlobalContractError({ AccountId: "publisher.near" }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalContractNotFoundError)
      expect((error as GlobalContractNotFoundError).identifier).toEqual({
        accountId: "publisher.near",
      })
    }
  })

  test("should stay typed when the identifier payload is unparseable", () => {
    // The cause name is authoritative: an unknown identifier shape (or none at
    // all) must not demote the error to a generic NetworkError, or exists()
    // helpers would misreport genuine "not found" answers as failures.
    for (const identifier of [undefined, null, 42, { something: "else" }]) {
      try {
        parseRpcError(noGlobalContractError(identifier))
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(GlobalContractNotFoundError)
        expect((error as GlobalContractNotFoundError).identifier).toEqual({
          accountId: "unknown",
        })
      }
    }
  })
})
