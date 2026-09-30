/**
 * Comprehensive unit tests for RPC error handler
 * Tests all error parsing logic to achieve full code coverage
 *
 * This file includes both synthetic test cases and REAL RPC error fixtures
 * captured from NEAR mainnet to ensure our error parsing works with actual responses.
 */

import { describe, expect, test } from "vitest"
import {
  checkOutcomeForFunctionCallError,
  extractErrorMessage,
  isRetryableStatus,
  parseQueryError,
  parseRpcError,
} from "../../src/core/rpc/rpc-error-handler.js"
import type {
  ExecutionOutcomeWithId,
  RpcTransaction,
} from "../../src/core/types.js"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  ContractExecutionError,
  ContractNotDeployedError,
  ContractStateTooLargeError,
  FunctionCallError,
  InternalServerError,
  InvalidAccountError,
  InvalidNonceError,
  InvalidShardIdError,
  InvalidTransactionError,
  NetworkError,
  NodeNotSyncedError,
  ParseError,
  ShardUnavailableError,
  TimeoutError,
  UnknownBlockError,
  UnknownChunkError,
  UnknownEpochError,
  UnknownReceiptError,
} from "../../src/errors/index.js"

// ==================== Real RPC Fixtures ====================
// These are ACTUAL error responses captured from NEAR mainnet RPC
// to ensure our error parsing works with real-world data.

/**
 * RPC Call: query({ request_type: 'view_account', account_id: 'this-account-does-not-exist-12345678.near' })
 * Response: UNKNOWN_ACCOUNT error from mainnet
 */
const REAL_UNKNOWN_ACCOUNT_ERROR = {
  name: "HANDLER_ERROR",
  cause: {
    info: {
      block_hash: "7KwKtM54UbF7RkpZ2vcMtVkq8QMvH82AYKk5dZvK5bZR",
      block_height: 172797974,
      requested_account_id: "this-account-does-not-exist-12345678.near",
    },
    name: "UNKNOWN_ACCOUNT",
  },
  code: -32000,
  message: "Server error",
  data: "account this-account-does-not-exist-12345678.near does not exist while viewing",
}

/**
 * RPC Call: query({ request_type: 'view_access_key', account_id: 'near', public_key: 'ed25519:HbcF7MfbaLv6EViPkS3pDELF5cfHDKV73JJR6TdYC5BV' })
 * Response: ACCESS_KEY_DOES_NOT_EXIST - note this comes in result.error, not as JSON-RPC error
 */
const REAL_ACCESS_KEY_ERROR_RESULT = {
  block_hash: "7KwKtM54UbF7RkpZ2vcMtVkq8QMvH82AYKk5dZvK5bZR",
  block_height: 172797974,
  error:
    "access key ed25519:HbcF7MfbaLv6EViPkS3pDELF5cfHDKV73JJR6TdYC5BV does not exist while viewing",
  logs: [],
}

/**
 * RPC Call: query({ request_type: 'view_account', account_id: 'near', block_id: 1 })
 * Response: UNKNOWN_BLOCK error for garbage-collected block
 */
const REAL_UNKNOWN_BLOCK_ERROR = {
  name: "HANDLER_ERROR",
  cause: {
    info: {
      block_reference: {
        block_id: 1,
      },
    },
    name: "UNKNOWN_BLOCK",
  },
  code: -32000,
  message: "Server error",
  data: "DB Not Found Error: BLOCK HEIGHT: 1 \n Cause: Unknown",
}

/**
 * RPC Call: query({ request_type: 'view_code', account_id: 'alice.near' })
 * Response: NO_CONTRACT_CODE error for account without contract
 */
const REAL_NO_CONTRACT_CODE_ERROR = {
  name: "HANDLER_ERROR",
  cause: {
    info: {
      block_hash: "316zpJHREgJvnhYZmANexYKQkAFoX5UFumKxhfjMFFJQ",
      block_height: 172798034,
      contract_account_id: "alice.near",
    },
    name: "NO_CONTRACT_CODE",
  },
  code: -32000,
  message: "Server error",
  data: "Contract code for contract ID #alice.near has never been observed on the node",
}

/**
 * RPC Call: query({ request_type: 'call_function', account_id: 'near', method_name: 'test' })
 * Response: Method not found error - note this comes in result.error, not as JSON-RPC error
 */
const REAL_METHOD_NOT_FOUND_RESULT = {
  block_hash: "7KwKtM54UbF7RkpZ2vcMtVkq8QMvH82AYKk5dZvK5bZR",
  block_height: 172797974,
  error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
  logs: [],
}

/**
 * RPC Call: query({ request_type: 'view_account', account_id: 'invalid..account' })
 * Response: PARSE_ERROR for invalid account ID format
 */
const REAL_PARSE_ERROR = {
  name: "REQUEST_VALIDATION_ERROR",
  cause: {
    name: "PARSE_ERROR",
    info: {
      error_message:
        "Failed parsing args: invalid value: \"invalid..account\", the Account ID has a redundant separator '.' at index 8",
    },
  },
  code: -32700,
  message: "Parse error",
  data: "Failed parsing args: invalid value: \"invalid..account\", the Account ID has a redundant separator '.' at index 8",
}

/**
 * RPC Call: tx({ tx_hash: '11111111111111111111111111111111', sender_account_id: 'near' })
 * Response: TIMEOUT_ERROR
 */
const REAL_TIMEOUT_ERROR = {
  name: "HANDLER_ERROR",
  cause: {
    name: "TIMEOUT_ERROR",
  },
  code: -32000,
  message: "Server error",
  data: "Timeout",
}

/**
 * RPC Call: chunk({ chunk_id: '11111111111111111111111111111111' })
 * Response: UNKNOWN_CHUNK error
 */
const REAL_UNKNOWN_CHUNK_ERROR = {
  name: "HANDLER_ERROR",
  cause: {
    info: {
      chunk_hash: "11111111111111111111111111111111",
    },
    name: "UNKNOWN_CHUNK",
  },
  code: -32000,
  message: "Server error",
  data: "Chunk Missing (unavailable on the node): ChunkHash(`11111111111111111111111111111111`) \n Cause: Unknown",
}

/**
 * RPC Call: invalid_method_name({})
 * Response: METHOD_NOT_FOUND error
 */
const REAL_METHOD_NOT_FOUND_RPC_ERROR = {
  name: "REQUEST_VALIDATION_ERROR",
  cause: {
    name: "METHOD_NOT_FOUND",
    info: {
      method_name: "this_method_does_not_exist",
    },
  },
  code: -32601,
  message: "Method not found",
  data: "this_method_does_not_exist",
}

// ==================== Test Data Factories ====================

function createMockOutcome(
  status: Record<string, unknown> | string,
  executorId = "contract.near",
  logs: string[] = [],
): ExecutionOutcomeWithId {
  return {
    id: "tx123",
    outcome: {
      logs,
      receipt_ids: [],
      gas_burnt: 1000000,
      tokens_burnt: "100000000000",
      executor_id: executorId,
      // Test helper - status can be any shape for testing
      status: status as unknown as
        | "Unknown"
        | "Pending"
        | { SuccessValue: string }
        | { SuccessReceiptId: string }
        | { Failure: Record<string, unknown> },
    },
    block_hash: "block123",
    proof: [],
  }
}

function createMockTransaction(methodName?: string): RpcTransaction {
  const actions = methodName
    ? [
        {
          FunctionCall: {
            method_name: methodName,
            args: "e30=", // base64 encoded {}
            gas: 30000000000000,
            deposit: "0",
          },
        },
      ]
    : []

  return {
    signer_id: "alice.near",
    public_key: "ed25519:ABC123",
    nonce: 1,
    receiver_id: "contract.near",
    actions,
    signature: "sig123",
    hash: "hash123",
  }
}

// ==================== parseRpcError() Tests ====================

describe("parseRpcError", () => {
  describe("General Errors (HANDLER_ERROR)", () => {
    test("returns UnknownBlockError for UNKNOWN_BLOCK", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Block not found",
        cause: {
          name: "UNKNOWN_BLOCK",
          info: {
            block_reference: "12345",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownBlockError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownBlockError)
        const err = e as UnknownBlockError
        expect(err.blockReference).toBe("12345")
      }
    })

    test("returns UnknownBlockError with message fallback when no block_reference", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Unknown block: finalized",
        cause: {
          name: "UNKNOWN_BLOCK",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownBlockError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownBlockError)
        const err = e as UnknownBlockError
        expect(err.blockReference).toBe("Unknown block: finalized")
      }
    })

    test("returns InvalidAccountError for INVALID_ACCOUNT", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid account ID",
        cause: {
          name: "INVALID_ACCOUNT",
          info: {
            requested_account_id: "invalid..account",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidAccountError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidAccountError)
        const err = e as InvalidAccountError
        expect(err.accountId).toBe("invalid..account")
      }
    })

    test("returns InvalidAccountError with unknown fallback", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid account ID",
        cause: {
          name: "INVALID_ACCOUNT",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidAccountError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidAccountError)
        const err = e as InvalidAccountError
        expect(err.accountId).toBe("unknown")
      }
    })

    test("returns AccountDoesNotExistError for UNKNOWN_ACCOUNT", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Account does not exist",
        cause: {
          name: "UNKNOWN_ACCOUNT",
          info: {
            requested_account_id: "missing.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(AccountDoesNotExistError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(AccountDoesNotExistError)
        const err = e as AccountDoesNotExistError
        expect(err.accountId).toBe("missing.near")
      }
    })

    test("returns AccessKeyDoesNotExistError for UNKNOWN_GAS_KEY", () => {
      // Captured from a 2.13 sandbox: view_gas_key_nonces on a non-gas key.
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Server error",
        data: "Gas key for public key ed25519:DQbqznEcti9RZZtjociwmoLUHDu2sAewsfowWBmXv3s5 does not exist while viewing",
        cause: {
          name: "UNKNOWN_GAS_KEY",
          info: {
            block_hash: "GoWEodM1by6QoEJfV9NMacT8qidM8haHGP8eCL4dZ4kv",
            block_height: 3,
            public_key: "ed25519:DQbqznEcti9RZZtjociwmoLUHDu2sAewsfowWBmXv3s5",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(AccessKeyDoesNotExistError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(AccessKeyDoesNotExistError)
        const err = e as AccessKeyDoesNotExistError
        expect(err.publicKey).toBe(
          "ed25519:DQbqznEcti9RZZtjociwmoLUHDu2sAewsfowWBmXv3s5",
        )
      }
    })

    test("returns ShardUnavailableError for UNAVAILABLE_SHARD", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Shard is currently unavailable",
        cause: {
          name: "UNAVAILABLE_SHARD",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ShardUnavailableError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ShardUnavailableError)
        const err = e as ShardUnavailableError
        expect(err.message).toContain("Shard is currently unavailable")
      }
    })

    test("returns NodeNotSyncedError for NO_SYNCED_BLOCKS", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Node has no synced blocks",
        cause: {
          name: "NO_SYNCED_BLOCKS",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(NodeNotSyncedError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(NodeNotSyncedError)
        const err = e as NodeNotSyncedError
        expect(err.message).toContain("Node has no synced blocks")
      }
    })

    test("returns NodeNotSyncedError for NOT_SYNCED_YET", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Node is not synced yet",
        cause: {
          name: "NOT_SYNCED_YET",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(NodeNotSyncedError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(NodeNotSyncedError)
      }
    })
  })

  describe("Contract Errors", () => {
    test("returns ContractNotDeployedError for NO_CONTRACT_CODE with account_id", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "No contract code",
        cause: {
          name: "NO_CONTRACT_CODE",
          info: {
            account_id: "empty.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractNotDeployedError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractNotDeployedError)
        const err = e as ContractNotDeployedError
        expect(err.accountId).toBe("empty.near")
      }
    })

    test("returns ContractNotDeployedError for NO_CONTRACT_CODE with contract_id", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "No contract code",
        cause: {
          name: "NO_CONTRACT_CODE",
          info: {
            contract_id: "empty.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractNotDeployedError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractNotDeployedError)
        const err = e as ContractNotDeployedError
        expect(err.accountId).toBe("empty.near")
      }
    })

    test("returns ContractNotDeployedError with unknown fallback", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "No contract code",
        cause: {
          name: "NO_CONTRACT_CODE",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractNotDeployedError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractNotDeployedError)
        const err = e as ContractNotDeployedError
        expect(err.accountId).toBe("unknown")
      }
    })

    test("returns ContractStateTooLargeError for TOO_LARGE_CONTRACT_STATE with account_id", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Contract state too large",
        cause: {
          name: "TOO_LARGE_CONTRACT_STATE",
          info: {
            account_id: "large.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractStateTooLargeError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractStateTooLargeError)
        const err = e as ContractStateTooLargeError
        expect(err.accountId).toBe("large.near")
      }
    })

    test("returns ContractStateTooLargeError for TOO_LARGE_CONTRACT_STATE with contract_id", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Contract state too large",
        cause: {
          name: "TOO_LARGE_CONTRACT_STATE",
          info: {
            contract_id: "large.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractStateTooLargeError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractStateTooLargeError)
        const err = e as ContractStateTooLargeError
        expect(err.accountId).toBe("large.near")
      }
    })

    test("returns ContractExecutionError for CONTRACT_EXECUTION_ERROR", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Contract execution error",
        cause: {
          name: "CONTRACT_EXECUTION_ERROR",
          info: {
            contract_id: "contract.near",
            method_name: "my_method",
            vm_error: "OutOfGas",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractExecutionError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractExecutionError)
        const err = e as ContractExecutionError
        expect(err.contractId).toBe("contract.near")
        expect(err.methodName).toBe("my_method")
        expect(err.details).toEqual({
          contract_id: "contract.near",
          method_name: "my_method",
          vm_error: "OutOfGas",
        })
      }
    })

    test("returns ContractExecutionError without method name", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Contract execution error",
        cause: {
          name: "CONTRACT_EXECUTION_ERROR",
          info: {
            contract_id: "contract.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ContractExecutionError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ContractExecutionError)
        const err = e as ContractExecutionError
        expect(err.contractId).toBe("contract.near")
        expect(err.methodName).toBeUndefined()
      }
    })

    test("returns FunctionCallError for ActionError", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Smart contract panicked: assertion failed",
        cause: {
          name: "ActionError",
          info: {
            contract_id: "contract.near",
            method_name: "transfer",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(FunctionCallError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(FunctionCallError)
        const err = e as FunctionCallError
        expect(err.contractId).toBe("contract.near")
        expect(err.methodName).toBe("transfer")
        expect(err.panic).toBe("Smart contract panicked: assertion failed")
      }
    })

    test("returns FunctionCallError for ActionError without method name", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Smart contract panicked",
        cause: {
          name: "ActionError",
          info: {
            contract_id: "contract.near",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(FunctionCallError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(FunctionCallError)
        const err = e as FunctionCallError
        expect(err.methodName).toBe("unknown")
      }
    })
  })

  describe("Block / Chunk Errors", () => {
    test("returns UnknownChunkError for UNKNOWN_CHUNK", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Chunk not found",
        cause: {
          name: "UNKNOWN_CHUNK",
          info: {
            chunk_reference: "chunk123",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownChunkError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownChunkError)
        const err = e as UnknownChunkError
        expect(err.chunkReference).toBe("chunk123")
      }
    })

    test("returns UnknownChunkError with message fallback", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Chunk not available",
        cause: {
          name: "UNKNOWN_CHUNK",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownChunkError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownChunkError)
        const err = e as UnknownChunkError
        expect(err.chunkReference).toBe("Chunk not available")
      }
    })

    test("returns InvalidShardIdError for INVALID_SHARD_ID with number", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid shard ID",
        cause: {
          name: "INVALID_SHARD_ID",
          info: {
            shard_id: 99,
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidShardIdError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidShardIdError)
        const err = e as InvalidShardIdError
        expect(err.shardId).toBe(99)
      }
    })

    test("returns InvalidShardIdError for INVALID_SHARD_ID with string", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid shard ID",
        cause: {
          name: "INVALID_SHARD_ID",
          info: {
            shard_id: "invalid",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidShardIdError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidShardIdError)
        const err = e as InvalidShardIdError
        expect(err.shardId).toBe("invalid")
      }
    })
  })

  describe("Network Errors", () => {
    test("returns UnknownEpochError for UNKNOWN_EPOCH", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Epoch not found",
        cause: {
          name: "UNKNOWN_EPOCH",
          info: {
            block_reference: "epoch123",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownEpochError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownEpochError)
        const err = e as UnknownEpochError
        expect(err.blockReference).toBe("epoch123")
      }
    })

    test("returns UnknownEpochError with message fallback", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Unknown epoch",
        cause: {
          name: "UNKNOWN_EPOCH",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownEpochError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownEpochError)
        const err = e as UnknownEpochError
        expect(err.blockReference).toBe("Unknown epoch")
      }
    })
  })

  describe("Transaction Errors", () => {
    test("returns InvalidNonceError for INVALID_TRANSACTION with InvalidNonce", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid transaction",
        cause: {
          name: "INVALID_TRANSACTION",
        },
        data: {
          TxExecutionError: {
            InvalidTxError: {
              InvalidNonce: {
                tx_nonce: 5,
                ak_nonce: 10,
              },
            },
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidNonceError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidNonceError)
        const err = e as InvalidNonceError
        expect(err.txNonce).toBe(5)
        expect(err.akNonce).toBe(10)
      }
    })

    test("returns InvalidNonceError for INVALID_TRANSACTION with direct InvalidTxError", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid transaction",
        cause: {
          name: "INVALID_TRANSACTION",
        },
        data: {
          InvalidTxError: {
            InvalidNonce: {
              tx_nonce: 3,
              ak_nonce: 7,
            },
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidNonceError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidNonceError)
        const err = e as InvalidNonceError
        expect(err.txNonce).toBe(3)
        expect(err.akNonce).toBe(7)
      }
    })

    test("returns InvalidTransactionError for INVALID_TRANSACTION without InvalidNonce", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Transaction signature is invalid",
        cause: {
          name: "INVALID_TRANSACTION",
          info: {
            transaction_hash: "tx123",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidTransactionError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidTransactionError)
        const err = e as InvalidTransactionError
        expect(err.message).toContain("Transaction signature is invalid")
      }
    })

    test("returns InvalidTransactionError with TxExecutionError details", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid transaction",
        cause: {
          name: "INVALID_TRANSACTION",
          info: {
            some_field: "value",
          },
        },
        data: {
          TxExecutionError: {
            error_type: "SignatureError",
            details: "Invalid signature",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidTransactionError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidTransactionError)
        const err = e as InvalidTransactionError
        expect(err.details).toEqual({
          some_field: "value",
          error_type: "SignatureError",
          details: "Invalid signature",
        })
      }
    })

    test("returns InvalidTransactionError with InvalidTxError details", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Invalid transaction",
        cause: {
          name: "INVALID_TRANSACTION",
        },
        data: {
          InvalidTxError: {
            error_type: "ExpiredError",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InvalidTransactionError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InvalidTransactionError)
        const err = e as InvalidTransactionError
        expect(err.details).toEqual({
          error_type: "ExpiredError",
        })
      }
    })

    test("returns UnknownReceiptError for UNKNOWN_RECEIPT", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Receipt not found",
        cause: {
          name: "UNKNOWN_RECEIPT",
          info: {
            receipt_id: "receipt123",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownReceiptError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownReceiptError)
        const err = e as UnknownReceiptError
        expect(err.receiptId).toBe("receipt123")
      }
    })

    test("returns UnknownReceiptError with unknown fallback", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Receipt not found",
        cause: {
          name: "UNKNOWN_RECEIPT",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(UnknownReceiptError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(UnknownReceiptError)
        const err = e as UnknownReceiptError
        expect(err.receiptId).toBe("unknown")
      }
    })

    test("returns TimeoutError for TIMEOUT_ERROR", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Transaction timed out",
        cause: {
          name: "TIMEOUT_ERROR",
          info: {
            transaction_hash: "tx123",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(TimeoutError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(TimeoutError)
        const err = e as TimeoutError
        expect(err.transactionHash).toBe("tx123")
      }
    })

    test("returns TimeoutError without transaction hash", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32000,
        message: "Request timed out",
        cause: {
          name: "TIMEOUT_ERROR",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(TimeoutError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(TimeoutError)
        const err = e as TimeoutError
        expect(err.transactionHash).toBeUndefined()
      }
    })
  })

  describe("Request Validation Errors", () => {
    test("returns ParseError for PARSE_ERROR", () => {
      const error = {
        name: "REQUEST_VALIDATION_ERROR",
        code: -32700,
        message: "Parse error: invalid JSON",
        cause: {
          name: "PARSE_ERROR",
          info: {
            position: 10,
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(ParseError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ParseError)
        const err = e as ParseError
        expect(err.message).toContain("Parse error: invalid JSON")
        expect(err.data).toEqual({ position: 10 })
      }
    })

    test("returns ParseError for REQUEST_VALIDATION_ERROR name", () => {
      const error = {
        name: "REQUEST_VALIDATION_ERROR",
        code: -32600,
        message: "Invalid request format",
      }

      expect(parseRpcError(error)).toBeInstanceOf(ParseError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(ParseError)
        const err = e as ParseError
        expect(err.message).toContain("Invalid request format")
      }
    })
  })

  describe("Internal Errors", () => {
    test("returns InternalServerError for INTERNAL_ERROR cause", () => {
      const error = {
        name: "HANDLER_ERROR",
        code: -32603,
        message: "Internal server error",
        cause: {
          name: "INTERNAL_ERROR",
          info: {
            error_details: "Database connection lost",
          },
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(InternalServerError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InternalServerError)
        const err = e as InternalServerError
        expect(err.message).toContain("Internal server error")
        expect(err.data).toEqual({
          error_details: "Database connection lost",
        })
      }
    })

    test("returns InternalServerError for INTERNAL_ERROR name", () => {
      const error = {
        name: "INTERNAL_ERROR",
        code: -32603,
        message: "Internal error occurred",
      }

      expect(parseRpcError(error)).toBeInstanceOf(InternalServerError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(InternalServerError)
        const err = e as InternalServerError
        expect(err.message).toContain("Internal error occurred")
      }
    })
  })

  describe("Unknown Error Types", () => {
    test("returns NetworkError for unknown error type with retryable status code", () => {
      const error = {
        name: "UNKNOWN_ERROR",
        code: -32000,
        message: "Some unknown error",
        cause: {
          name: "CUSTOM_ERROR",
        },
      }

      expect(parseRpcError(error, 503)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(error, 503)

        expect(e).toBeInstanceOf(NetworkError)
        const err = e as NetworkError
        expect(err.message).toContain("RPC error [CUSTOM_ERROR]")
        expect(err.message).toContain("Some unknown error")
        expect(err.retryable).toBe(true)
      }
    })

    test("returns NetworkError for unknown error type with non-retryable status code", () => {
      const error = {
        name: "UNKNOWN_ERROR",
        code: -32000,
        message: "Some unknown error",
        cause: {
          name: "CUSTOM_ERROR",
        },
      }

      expect(parseRpcError(error, 400)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(error, 400)

        expect(e).toBeInstanceOf(NetworkError)
        const err = e as NetworkError
        expect(err.retryable).toBe(false)
      }
    })

    test("returns NetworkError for error without cause using error name", () => {
      const error = {
        name: "CUSTOM_ERROR",
        code: -32000,
        message: "Custom error occurred",
      }

      expect(parseRpcError(error)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(NetworkError)
        const err = e as NetworkError
        expect(err.message).toContain("RPC error [CUSTOM_ERROR]")
        expect(err.message).toContain("Custom error occurred")
      }
    })

    test("returns NetworkError when no status code provided", () => {
      const error = {
        name: "UNKNOWN_ERROR",
        code: -32000,
        message: "Unknown error",
        cause: {
          name: "UNKNOWN_CAUSE",
        },
      }

      expect(parseRpcError(error)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(error)

        expect(e).toBeInstanceOf(NetworkError)
        const err = e as NetworkError
        expect(err.retryable).toBe(false)
      }
    })
  })

  describe("Error Parsing Edge Cases", () => {
    test("returns NetworkError when error is undefined", () => {
      expect(parseRpcError(undefined)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(undefined)

        expect(e).toBeInstanceOf(NetworkError)
        const err = e as NetworkError
        expect(err.message).toBe("Unknown RPC error")
      }
    })

    test("returns a network failure for malformed RPC error names", () => {
      const malformedError = {
        name: 123, // Invalid type - should fail schema validation
        code: -32000,
        message: "test",
      }

      // The schema validation will fail, but we should still get a NetworkError
      expect(parseRpcError(malformedError)).toBeInstanceOf(NetworkError)
    })

    test("returns NetworkError when schema parsing fails", () => {
      const invalidError = {
        name: "TEST",
        code: "not-a-number", // Invalid type
        message: "test",
      }

      expect(parseRpcError(invalidError)).toBeInstanceOf(NetworkError)

      {
        const e = parseRpcError(invalidError)

        expect(e).toBeInstanceOf(NetworkError)
      }
    })
  })
})

// ==================== extractErrorMessage() Tests ====================

describe("extractErrorMessage", () => {
  test("should extract error type from ActionError with FunctionCallError", () => {
    const failure = {
      ActionError: {
        kind: {
          FunctionCallError: {
            ExecutionError: "Smart contract panicked",
          },
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe(
      "FunctionCallError (ExecutionError: Smart contract panicked)",
    )
  })

  test("should extract error type from ActionError with multiple data fields", () => {
    const failure = {
      ActionError: {
        kind: {
          LackBalanceForState: {
            account_id: "alice.near",
            balance: "1000000",
          },
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toContain("LackBalanceForState")
    expect(message).toContain("account_id: alice.near")
    expect(message).toContain("balance: 1000000")
  })

  test("should extract error type from ActionError with simple error", () => {
    const failure = {
      ActionError: {
        kind: {
          AccountAlreadyExists: {
            account_id: "alice.near",
          },
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toContain("AccountAlreadyExists")
    expect(message).toContain("account_id: alice.near")
  })

  test("should return error type when kind has null data", () => {
    const failure = {
      ActionError: {
        kind: {
          OnlyImplicitAccountCreationAllowed: null,
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe("OnlyImplicitAccountCreationAllowed")
  })

  test("should return error type when kind has empty object data", () => {
    const failure = {
      ActionError: {
        kind: {
          DeleteKeyDoesNotExist: {},
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe("DeleteKeyDoesNotExist ()")
  })

  test("should return JSON when kind has no keys", () => {
    const failure = {
      ActionError: {
        kind: {},
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe(JSON.stringify(failure))
  })

  test("should return JSON when ActionError has no kind", () => {
    const failure = {
      ActionError: {
        index: 0,
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe(JSON.stringify(failure))
  })

  test("should return JSON when ActionError kind is null", () => {
    const failure = {
      ActionError: {
        kind: null,
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe(JSON.stringify(failure))
  })

  test("should return JSON for non-ActionError failures", () => {
    const failure = {
      SomeOtherError: {
        message: "error",
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe(JSON.stringify(failure))
  })

  test("should handle ActionError with primitive error data", () => {
    const failure = {
      ActionError: {
        kind: {
          ErrorType: "simple string error",
        },
      },
    }

    const message = extractErrorMessage(failure)
    expect(message).toBe("ErrorType")
  })
})

// ==================== checkOutcomeForFunctionCallError() Tests ====================

describe("checkOutcomeForFunctionCallError", () => {
  test("returns FunctionCallError when outcome has ActionError with FunctionCallError", () => {
    const outcome = createMockOutcome(
      {
        Failure: {
          ActionError: {
            kind: {
              FunctionCallError: {
                ExecutionError: "Smart contract panicked: assertion failed",
              },
            },
          },
        },
      },
      "contract.near",
      ["log1", "log2"],
    )

    const transaction = createMockTransaction("my_method")

    expect(
      checkOutcomeForFunctionCallError(outcome, transaction),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.contractId).toBe("contract.near")
      expect(err.methodName).toBe("my_method")
      expect(err.panic).toBe("Smart contract panicked: assertion failed")
      expect(err.logs).toEqual(["log1", "log2"])
    }
  })

  test("returns FunctionCallError with HostError", () => {
    const outcome = createMockOutcome({
      Failure: {
        ActionError: {
          kind: {
            FunctionCallError: {
              HostError: "GasLimitExceeded",
            },
          },
        },
      },
    })

    const transaction = createMockTransaction("test")

    expect(
      checkOutcomeForFunctionCallError(outcome, transaction),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.panic).toBe("GasLimitExceeded")
    }
  })

  test("returns FunctionCallError when FunctionCallError is direct (not in ActionError)", () => {
    const outcome = createMockOutcome({
      Failure: {
        FunctionCallError: {
          ExecutionError: "Direct function call error",
        },
      },
    })

    const transaction = createMockTransaction("my_method")

    expect(
      checkOutcomeForFunctionCallError(outcome, transaction),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.panic).toBe("Direct function call error")
    }
  })

  test("returns FunctionCallError with JSON stringified error when no ExecutionError or HostError", () => {
    const outcome = createMockOutcome({
      Failure: {
        ActionError: {
          kind: {
            FunctionCallError: {
              CompilationError: "Wasm compilation failed",
            },
          },
        },
      },
    })

    const transaction = createMockTransaction()

    expect(
      checkOutcomeForFunctionCallError(outcome, transaction),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.panic).toBe(
        JSON.stringify({ CompilationError: "Wasm compilation failed" }),
      )
    }
  })

  test("returns no error when outcome status is success", () => {
    const outcome = createMockOutcome({ SuccessValue: "e30=" })

    expect(
      checkOutcomeForFunctionCallError(outcome, createMockTransaction()),
    ).toBeUndefined()
  })

  test("returns no error when outcome status is success receipt", () => {
    const outcome = createMockOutcome({ SuccessReceiptId: "receipt123" })

    expect(
      checkOutcomeForFunctionCallError(outcome, createMockTransaction()),
    ).toBeUndefined()
  })

  test("returns no error when failure is not FunctionCallError", () => {
    const outcome = createMockOutcome({
      Failure: {
        ActionError: {
          kind: {
            AccountAlreadyExists: {
              account_id: "alice.near",
            },
          },
        },
      },
    })

    expect(
      checkOutcomeForFunctionCallError(outcome, createMockTransaction()),
    ).toBeUndefined()
  })

  test("returns no error when status is a string", () => {
    const outcome = createMockOutcome("Unknown")

    expect(
      checkOutcomeForFunctionCallError(outcome, createMockTransaction()),
    ).toBeUndefined()
  })

  test("should extract method name from transaction when available", () => {
    const outcome = createMockOutcome({
      Failure: {
        FunctionCallError: {
          ExecutionError: "error",
        },
      },
    })

    const transaction = createMockTransaction("transfer")

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      const err = e as FunctionCallError
      expect(err.methodName).toBe("transfer")
    }
  })

  test("should handle undefined method name when transaction has no actions", () => {
    const outcome = createMockOutcome({
      Failure: {
        FunctionCallError: {
          ExecutionError: "error",
        },
      },
    })

    const transaction = createMockTransaction()

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      const err = e as FunctionCallError
      expect(err.methodName).toBeUndefined()
    }
  })

  test("should handle undefined method name when transaction is undefined", () => {
    const outcome = createMockOutcome({
      Failure: {
        FunctionCallError: {
          ExecutionError: "error",
        },
      },
    })

    {
      const e = checkOutcomeForFunctionCallError(outcome, undefined)

      const err = e as FunctionCallError
      expect(err.methodName).toBeUndefined()
    }
  })

  test("should handle transaction with non-FunctionCall actions", () => {
    const outcome = createMockOutcome({
      Failure: {
        FunctionCallError: {
          ExecutionError: "error",
        },
      },
    })

    const transaction: RpcTransaction = {
      signer_id: "alice.near",
      public_key: "ed25519:ABC",
      nonce: 1,
      receiver_id: "bob.near",
      actions: [{ Transfer: { deposit: "1000000" } }],
      signature: "sig",
      hash: "hash",
    }

    {
      const e = checkOutcomeForFunctionCallError(outcome, transaction)

      const err = e as FunctionCallError
      expect(err.methodName).toBeUndefined()
    }
  })
})

// ==================== isRetryableStatus() Tests ====================

describe("isRetryableStatus", () => {
  test("should return true for 408 Request Timeout", () => {
    expect(isRetryableStatus(408)).toBe(true)
  })

  test("should return true for 429 Too Many Requests", () => {
    expect(isRetryableStatus(429)).toBe(true)
  })

  test("should return true for 503 Service Unavailable", () => {
    expect(isRetryableStatus(503)).toBe(true)
  })

  test("should return true for 500 Internal Server Error", () => {
    expect(isRetryableStatus(500)).toBe(true)
  })

  test("should return true for 502 Bad Gateway", () => {
    expect(isRetryableStatus(502)).toBe(true)
  })

  test("should return true for 504 Gateway Timeout", () => {
    expect(isRetryableStatus(504)).toBe(true)
  })

  test("should return true for other 5xx errors", () => {
    expect(isRetryableStatus(501)).toBe(true)
    expect(isRetryableStatus(505)).toBe(true)
    expect(isRetryableStatus(599)).toBe(true)
  })

  test("should return false for 400 Bad Request", () => {
    expect(isRetryableStatus(400)).toBe(false)
  })

  test("should return false for 401 Unauthorized", () => {
    expect(isRetryableStatus(401)).toBe(false)
  })

  test("should return false for 403 Forbidden", () => {
    expect(isRetryableStatus(403)).toBe(false)
  })

  test("should return false for 404 Not Found", () => {
    expect(isRetryableStatus(404)).toBe(false)
  })

  test("should return false for 200 OK", () => {
    expect(isRetryableStatus(200)).toBe(false)
  })

  test("should return false for 201 Created", () => {
    expect(isRetryableStatus(201)).toBe(false)
  })

  test("should return false for 300 Multiple Choices", () => {
    expect(isRetryableStatus(300)).toBe(false)
  })

  test("should return false for 301 Moved Permanently", () => {
    expect(isRetryableStatus(301)).toBe(false)
  })
})

// ==================== parseQueryError() Tests ====================

describe("parseQueryError - additional coverage", () => {
  test("returns no error when result is not an object", () => {
    expect(parseQueryError("not an object", {})).toBeUndefined()
    expect(parseQueryError(123, {})).toBeUndefined()
    expect(parseQueryError(true, {})).toBeUndefined()
  })

  test("returns FunctionCallError with contractId even without methodName", () => {
    const result = {
      error: "Contract execution failed",
    }

    expect(
      parseQueryError(result, {
        contractId: "contract.near",
      }),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = parseQueryError(result, {
        contractId: "contract.near",
      })

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.contractId).toBe("contract.near")
      expect(err.methodName).toBeUndefined()
      expect(err.panic).toBe("Contract execution failed")
    }
  })

  test("should handle empty context object", () => {
    const result = {
      error: "Generic error message",
    }

    expect(parseQueryError(result)).toBeInstanceOf(NetworkError)

    {
      const e = parseQueryError(result)

      expect(e).toBeInstanceOf(NetworkError)
      const err = e as NetworkError
      expect(err.message).toContain("Query error")
      expect(err.message).toContain("Generic error message")
    }
  })
})

// ==================== Real RPC Fixtures Tests ====================
// These tests use ACTUAL error responses captured from NEAR mainnet
// to ensure our error parsing works with real-world data.

describe("parseRpcError - Real RPC Fixtures", () => {
  test("should parse real UNKNOWN_ACCOUNT error from mainnet", () => {
    expect(parseRpcError(REAL_UNKNOWN_ACCOUNT_ERROR)).toBeInstanceOf(
      AccountDoesNotExistError,
    )

    {
      const e = parseRpcError(REAL_UNKNOWN_ACCOUNT_ERROR)

      expect(e).toBeInstanceOf(AccountDoesNotExistError)
      const err = e as AccountDoesNotExistError
      expect(err.accountId).toBe("this-account-does-not-exist-12345678.near")
      expect(err.message).toContain("this-account-does-not-exist-12345678.near")
    }
  })

  test("should parse real UNKNOWN_BLOCK error from mainnet", () => {
    expect(parseRpcError(REAL_UNKNOWN_BLOCK_ERROR)).toBeInstanceOf(
      UnknownBlockError,
    )

    {
      const e = parseRpcError(REAL_UNKNOWN_BLOCK_ERROR)

      expect(e).toBeInstanceOf(UnknownBlockError)
      const err = e as UnknownBlockError
      // Real error has block_reference as an object {block_id: 1}
      // Error handler converts it to string via JSON.stringify or toString
      expect(err.blockReference).toBeTruthy()
    }
  })

  test("should parse real NO_CONTRACT_CODE error from mainnet", () => {
    expect(parseRpcError(REAL_NO_CONTRACT_CODE_ERROR)).toBeInstanceOf(
      ContractNotDeployedError,
    )

    {
      const e = parseRpcError(REAL_NO_CONTRACT_CODE_ERROR)

      expect(e).toBeInstanceOf(ContractNotDeployedError)
      const err = e as ContractNotDeployedError
      // Real error uses 'contract_account_id' field
      // Error handler now correctly extracts this field
      expect(err.accountId).toBe("alice.near")
      expect(err.message).toContain("No contract deployed")
    }
  })

  test("should parse real PARSE_ERROR from mainnet", () => {
    expect(parseRpcError(REAL_PARSE_ERROR)).toBeInstanceOf(ParseError)

    {
      const e = parseRpcError(REAL_PARSE_ERROR)

      expect(e).toBeInstanceOf(ParseError)
      const err = e as ParseError
      expect(err.message).toContain("Parse error")
      expect(err.data).toEqual({
        error_message:
          "Failed parsing args: invalid value: \"invalid..account\", the Account ID has a redundant separator '.' at index 8",
      })
    }
  })

  test("should parse real TIMEOUT_ERROR from mainnet", () => {
    expect(parseRpcError(REAL_TIMEOUT_ERROR)).toBeInstanceOf(TimeoutError)

    {
      const e = parseRpcError(REAL_TIMEOUT_ERROR)

      expect(e).toBeInstanceOf(TimeoutError)
      const err = e as TimeoutError
      // Error handler uses error.message which is "Server error" in real response
      // The actual "Timeout" text is in the data field
      expect(err.message).toContain("Server error")
      expect(err.transactionHash).toBeUndefined()
    }
  })

  test("should parse real UNKNOWN_CHUNK error from mainnet", () => {
    expect(parseRpcError(REAL_UNKNOWN_CHUNK_ERROR)).toBeInstanceOf(
      UnknownChunkError,
    )

    {
      const e = parseRpcError(REAL_UNKNOWN_CHUNK_ERROR)

      expect(e).toBeInstanceOf(UnknownChunkError)
    }
  })

  test("should parse real METHOD_NOT_FOUND error from mainnet", () => {
    // Note: This is a REQUEST_VALIDATION_ERROR, which returns ParseError
    expect(parseRpcError(REAL_METHOD_NOT_FOUND_RPC_ERROR)).toBeInstanceOf(
      ParseError,
    )

    {
      const e = parseRpcError(REAL_METHOD_NOT_FOUND_RPC_ERROR)

      expect(e).toBeInstanceOf(ParseError)
      const err = e as ParseError
      expect(err.message).toContain("Method not found")
    }
  })
})

describe("parseQueryError - Real RPC Fixtures", () => {
  test("should parse real access key error from result.error field", () => {
    expect(
      parseQueryError(REAL_ACCESS_KEY_ERROR_RESULT, {
        accountId: "near",
        publicKey: "ed25519:HbcF7MfbaLv6EViPkS3pDELF5cfHDKV73JJR6TdYC5BV",
      }),
    ).toBeInstanceOf(AccessKeyDoesNotExistError)

    {
      const e = parseQueryError(REAL_ACCESS_KEY_ERROR_RESULT, {
        accountId: "near",
        publicKey: "ed25519:HbcF7MfbaLv6EViPkS3pDELF5cfHDKV73JJR6TdYC5BV",
      })

      expect(e).toBeInstanceOf(AccessKeyDoesNotExistError)
      const err = e as AccessKeyDoesNotExistError
      expect(err.accountId).toBe("near")
      expect(err.publicKey).toBe(
        "ed25519:HbcF7MfbaLv6EViPkS3pDELF5cfHDKV73JJR6TdYC5BV",
      )
    }
  })

  test("should parse real method not found error from result.error field", () => {
    expect(
      parseQueryError(REAL_METHOD_NOT_FOUND_RESULT, {
        contractId: "near",
        methodName: "test",
      }),
    ).toBeInstanceOf(FunctionCallError)

    {
      const e = parseQueryError(REAL_METHOD_NOT_FOUND_RESULT, {
        contractId: "near",
        methodName: "test",
      })

      expect(e).toBeInstanceOf(FunctionCallError)
      const err = e as FunctionCallError
      expect(err.contractId).toBe("near")
      expect(err.methodName).toBe("test")
      expect(err.panic).toBe(
        "wasm execution failed with error: MethodResolveError(MethodNotFound)",
      )
    }
  })
})
