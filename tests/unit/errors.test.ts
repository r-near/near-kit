/**
 * Comprehensive tests for all error classes
 */

import { describe, expect, test } from "bun:test"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  ContractExecutionError,
  ContractNotDeployedError,
  ContractStateTooLargeError,
  FunctionCallError,
  GasLimitExceededError,
  InsufficientBalanceError,
  InternalServerError,
  InvalidAccountError,
  InvalidAccountIdError,
  InvalidKeyError,
  InvalidNonceError,
  InvalidShardIdError,
  InvalidTransactionError,
  NearError,
  NetworkError,
  NodeNotSyncedError,
  ParseError,
  ShardUnavailableError,
  SignatureError,
  TimeoutError,
  TransactionTimeoutError,
  UnknownBlockError,
  UnknownChunkError,
  UnknownEpochError,
  UnknownReceiptError,
  WalletError,
} from "../../src/errors/index.js"

describe("NearError (base class)", () => {
  test("creates error with message and code", () => {
    const error = new NearError("test message", "TEST_CODE")
    expect(error.message).toBe("test message")
    expect(error.code).toBe("TEST_CODE")
    expect(error.name).toBe("NearError")
    expect(error.data).toBeUndefined()
  })

  test("creates error with optional data", () => {
    const data = { foo: "bar", value: 123 }
    const error = new NearError("test message", "TEST_CODE", data)
    expect(error.data).toEqual(data)
  })

  test("is instance of Error", () => {
    const error = new NearError("test", "TEST")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(NearError)
  })

  test("has correct prototype chain", () => {
    const error = new NearError("test", "TEST")
    expect(Object.getPrototypeOf(error)).toBe(NearError.prototype)
  })
})

describe("InsufficientBalanceError", () => {
  test("creates error with required and available amounts", () => {
    const error = new InsufficientBalanceError("100", "50")
    expect(error.required).toBe("100")
    expect(error.available).toBe("50")
    expect(error.code).toBe("INSUFFICIENT_BALANCE")
    expect(error.name).toBe("InsufficientBalanceError")
  })

  test("formats message correctly", () => {
    const error = new InsufficientBalanceError("100", "50")
    expect(error.message).toBe(
      "Insufficient balance: required 100 NEAR, available 50 NEAR",
    )
  })

  test("is instance of NearError", () => {
    const error = new InsufficientBalanceError("100", "50")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InsufficientBalanceError)
  })

  test("has correct prototype chain", () => {
    const error = new InsufficientBalanceError("100", "50")
    expect(Object.getPrototypeOf(error)).toBe(
      InsufficientBalanceError.prototype,
    )
  })
})

describe("FunctionCallError", () => {
  test("creates error with contractId only", () => {
    const error = new FunctionCallError("contract.near", undefined)
    expect(error.contractId).toBe("contract.near")
    expect(error.methodName).toBeUndefined()
    expect(error.panic).toBeUndefined()
    expect(error.logs).toEqual([])
    expect(error.code).toBe("FUNCTION_CALL_ERROR")
    expect(error.name).toBe("FunctionCallError")
  })

  test("creates error with contractId and methodName", () => {
    const error = new FunctionCallError("contract.near", "myMethod")
    expect(error.contractId).toBe("contract.near")
    expect(error.methodName).toBe("myMethod")
    expect(error.panic).toBeUndefined()
    expect(error.logs).toEqual([])
  })

  test("creates error with panic message", () => {
    const error = new FunctionCallError(
      "contract.near",
      "myMethod",
      "smart contract panicked",
    )
    expect(error.panic).toBe("smart contract panicked")
  })

  test("creates error with logs", () => {
    const logs = ["log1", "log2", "log3"]
    const error = new FunctionCallError(
      "contract.near",
      "myMethod",
      undefined,
      logs,
    )
    expect(error.logs).toEqual(logs)
  })

  test("formats message without methodName", () => {
    const error = new FunctionCallError("contract.near", undefined)
    expect(error.message).toBe("Contract call failed: contract.near")
  })

  test("formats message with methodName", () => {
    const error = new FunctionCallError("contract.near", "myMethod")
    expect(error.message).toBe("Contract call failed: contract.near.myMethod")
  })

  test("formats message with panic", () => {
    const error = new FunctionCallError(
      "contract.near",
      "myMethod",
      "execution failed",
    )
    expect(error.message).toBe(
      "Contract call failed: contract.near.myMethod - execution failed",
    )
  })

  test("formats message with panic but no methodName", () => {
    const error = new FunctionCallError(
      "contract.near",
      undefined,
      "execution failed",
    )
    expect(error.message).toBe(
      "Contract call failed: contract.near - execution failed",
    )
  })

  test("is instance of NearError", () => {
    const error = new FunctionCallError("contract.near", "method")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(FunctionCallError)
  })
})

describe("NetworkError", () => {
  test("creates error with message only", () => {
    const error = new NetworkError("network failed")
    expect(error.message).toBe("network failed")
    expect(error.code).toBe("NETWORK_ERROR")
    expect(error.name).toBe("NetworkError")
    expect(error.statusCode).toBeUndefined()
    expect(error.retryable).toBe(true)
  })

  test("creates error with statusCode", () => {
    const error = new NetworkError("network failed", 500)
    expect(error.statusCode).toBe(500)
    expect(error.data).toEqual({ statusCode: 500 })
  })

  test("creates error with retryable = false", () => {
    const error = new NetworkError("network failed", 404, false)
    expect(error.retryable).toBe(false)
  })

  test("defaults retryable to true", () => {
    const error = new NetworkError("network failed", 500)
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new NetworkError("network failed")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(NetworkError)
  })
})

describe("InvalidKeyError", () => {
  test("creates error with custom message", () => {
    const error = new InvalidKeyError("invalid key format")
    expect(error.message).toBe("invalid key format")
    expect(error.code).toBe("INVALID_KEY")
    expect(error.name).toBe("InvalidKeyError")
  })

  test("is instance of NearError", () => {
    const error = new InvalidKeyError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidKeyError)
  })
})

describe("AccountDoesNotExistError", () => {
  test("creates error with accountId", () => {
    const error = new AccountDoesNotExistError("missing.near")
    expect(error.accountId).toBe("missing.near")
    expect(error.code).toBe("ACCOUNT_NOT_FOUND")
    expect(error.name).toBe("AccountDoesNotExistError")
    expect(error.message).toBe("Account does not exist: missing.near")
  })

  test("is instance of NearError", () => {
    const error = new AccountDoesNotExistError("test.near")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(AccountDoesNotExistError)
  })
})

describe("AccessKeyDoesNotExistError", () => {
  test("creates error with accountId and publicKey", () => {
    const error = new AccessKeyDoesNotExistError(
      "account.near",
      "ed25519:abc123",
    )
    expect(error.accountId).toBe("account.near")
    expect(error.publicKey).toBe("ed25519:abc123")
    expect(error.code).toBe("ACCESS_KEY_NOT_FOUND")
    expect(error.name).toBe("AccessKeyDoesNotExistError")
  })

  test("formats message correctly", () => {
    const error = new AccessKeyDoesNotExistError(
      "account.near",
      "ed25519:abc123",
    )
    expect(error.message).toBe(
      "Access key does not exist: ed25519:abc123 for account account.near",
    )
  })

  test("is instance of NearError", () => {
    const error = new AccessKeyDoesNotExistError("account.near", "key")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
  })
})

describe("InvalidAccountIdError", () => {
  test("creates error without reason", () => {
    const error = new InvalidAccountIdError("bad-account")
    expect(error.accountId).toBe("bad-account")
    expect(error.code).toBe("INVALID_ACCOUNT_ID")
    expect(error.name).toBe("InvalidAccountIdError")
    expect(error.message).toBe("Invalid account ID: bad-account")
  })

  test("creates error with reason", () => {
    const error = new InvalidAccountIdError("bad-account", "too short")
    expect(error.message).toBe("Invalid account ID: bad-account - too short")
  })

  test("is instance of NearError", () => {
    const error = new InvalidAccountIdError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidAccountIdError)
  })
})

describe("SignatureError", () => {
  test("creates error with custom message", () => {
    const error = new SignatureError("signature verification failed")
    expect(error.message).toBe("signature verification failed")
    expect(error.code).toBe("SIGNATURE_ERROR")
    expect(error.name).toBe("SignatureError")
  })

  test("is instance of NearError", () => {
    const error = new SignatureError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(SignatureError)
  })
})

describe("GasLimitExceededError", () => {
  test("creates error with gasUsed and gasLimit", () => {
    const error = new GasLimitExceededError("300 Tgas", "200 Tgas")
    expect(error.gasUsed).toBe("300 Tgas")
    expect(error.gasLimit).toBe("200 Tgas")
    expect(error.code).toBe("GAS_LIMIT_EXCEEDED")
    expect(error.name).toBe("GasLimitExceededError")
  })

  test("formats message correctly", () => {
    const error = new GasLimitExceededError("300 Tgas", "200 Tgas")
    expect(error.message).toBe(
      "Gas limit exceeded: used 300 Tgas, limit 200 Tgas",
    )
  })

  test("is instance of NearError", () => {
    const error = new GasLimitExceededError("300", "200")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(GasLimitExceededError)
  })
})

describe("TransactionTimeoutError", () => {
  test("creates error with transactionHash", () => {
    const error = new TransactionTimeoutError("abc123hash")
    expect(error.transactionHash).toBe("abc123hash")
    expect(error.code).toBe("TRANSACTION_TIMEOUT")
    expect(error.name).toBe("TransactionTimeoutError")
    expect(error.message).toBe("Transaction timed out: abc123hash")
  })

  test("is instance of NearError", () => {
    const error = new TransactionTimeoutError("hash")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(TransactionTimeoutError)
  })
})

describe("WalletError", () => {
  test("creates error with custom message", () => {
    const error = new WalletError("wallet connection failed")
    expect(error.message).toBe("wallet connection failed")
    expect(error.code).toBe("WALLET_ERROR")
    expect(error.name).toBe("WalletError")
  })

  test("is instance of NearError", () => {
    const error = new WalletError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(WalletError)
  })
})

describe("UnknownBlockError", () => {
  test("creates error with blockReference", () => {
    const error = new UnknownBlockError("12345")
    expect(error.blockReference).toBe("12345")
    expect(error.code).toBe("UNKNOWN_BLOCK")
    expect(error.name).toBe("UnknownBlockError")
  })

  test("includes helpful message about archival nodes", () => {
    const error = new UnknownBlockError("12345")
    expect(error.message).toContain("Block not found: 12345")
    expect(error.message).toContain("garbage-collected")
    expect(error.message).toContain("archival node")
  })

  test("is instance of NearError", () => {
    const error = new UnknownBlockError("12345")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(UnknownBlockError)
  })
})

describe("InvalidAccountError", () => {
  test("creates error with accountId", () => {
    const error = new InvalidAccountError("bad@account")
    expect(error.accountId).toBe("bad@account")
    expect(error.code).toBe("INVALID_ACCOUNT")
    expect(error.name).toBe("InvalidAccountError")
    expect(error.message).toBe("Invalid account ID format: bad@account")
  })

  test("is instance of NearError", () => {
    const error = new InvalidAccountError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidAccountError)
  })
})

describe("ShardUnavailableError", () => {
  test("creates error with default message", () => {
    const error = new ShardUnavailableError()
    expect(error.code).toBe("UNAVAILABLE_SHARD")
    expect(error.name).toBe("ShardUnavailableError")
    expect(error.retryable).toBe(true)
    expect(error.message).toContain("shard is not tracked")
  })

  test("creates error with custom message", () => {
    const error = new ShardUnavailableError("custom message")
    expect(error.message).toBe("custom message")
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new ShardUnavailableError()
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(ShardUnavailableError)
  })
})

describe("NodeNotSyncedError", () => {
  test("creates error with default message", () => {
    const error = new NodeNotSyncedError()
    expect(error.code).toBe("NOT_SYNCED")
    expect(error.name).toBe("NodeNotSyncedError")
    expect(error.retryable).toBe(true)
    expect(error.message).toContain("still syncing")
  })

  test("creates error with custom message", () => {
    const error = new NodeNotSyncedError("custom sync message")
    expect(error.message).toBe("custom sync message")
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new NodeNotSyncedError()
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(NodeNotSyncedError)
  })
})

describe("ContractNotDeployedError", () => {
  test("creates error with accountId", () => {
    const error = new ContractNotDeployedError("contract.near")
    expect(error.accountId).toBe("contract.near")
    expect(error.code).toBe("NO_CONTRACT_CODE")
    expect(error.name).toBe("ContractNotDeployedError")
    expect(error.message).toBe("No contract deployed on account: contract.near")
  })

  test("is instance of NearError", () => {
    const error = new ContractNotDeployedError("test.near")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(ContractNotDeployedError)
  })
})

describe("ContractStateTooLargeError", () => {
  test("creates error with accountId", () => {
    const error = new ContractStateTooLargeError("contract.near")
    expect(error.accountId).toBe("contract.near")
    expect(error.code).toBe("TOO_LARGE_CONTRACT_STATE")
    expect(error.name).toBe("ContractStateTooLargeError")
  })

  test("includes helpful message about size limits", () => {
    const error = new ContractStateTooLargeError("contract.near")
    expect(error.message).toContain("too large")
    expect(error.message).toContain(">50kb")
    expect(error.message).toContain("contract.near")
  })

  test("is instance of NearError", () => {
    const error = new ContractStateTooLargeError("test.near")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(ContractStateTooLargeError)
  })
})

describe("ContractExecutionError", () => {
  test("creates error with contractId only", () => {
    const error = new ContractExecutionError("contract.near")
    expect(error.contractId).toBe("contract.near")
    expect(error.methodName).toBeUndefined()
    expect(error.details).toBeUndefined()
    expect(error.code).toBe("CONTRACT_EXECUTION_ERROR")
    expect(error.name).toBe("ContractExecutionError")
    expect(error.message).toBe("Contract execution failed: contract.near")
  })

  test("creates error with methodName", () => {
    const error = new ContractExecutionError("contract.near", "myMethod")
    expect(error.methodName).toBe("myMethod")
    expect(error.message).toBe(
      "Contract execution failed: contract.near.myMethod",
    )
  })

  test("creates error with details", () => {
    const details = { reason: "execution error" }
    const error = new ContractExecutionError(
      "contract.near",
      "myMethod",
      details,
    )
    expect(error.details).toEqual(details)
    expect(error.data).toEqual(details)
  })

  test("is instance of NearError", () => {
    const error = new ContractExecutionError("test.near")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(ContractExecutionError)
  })
})

describe("UnknownChunkError", () => {
  test("creates error with chunkReference", () => {
    const error = new UnknownChunkError("chunk123")
    expect(error.chunkReference).toBe("chunk123")
    expect(error.code).toBe("UNKNOWN_CHUNK")
    expect(error.name).toBe("UnknownChunkError")
  })

  test("includes helpful message about archival nodes", () => {
    const error = new UnknownChunkError("chunk123")
    expect(error.message).toContain("Chunk not found: chunk123")
    expect(error.message).toContain("garbage-collected")
    expect(error.message).toContain("archival node")
  })

  test("is instance of NearError", () => {
    const error = new UnknownChunkError("chunk")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(UnknownChunkError)
  })
})

describe("InvalidShardIdError", () => {
  test("creates error with numeric shardId", () => {
    const error = new InvalidShardIdError(999)
    expect(error.shardId).toBe(999)
    expect(error.code).toBe("INVALID_SHARD_ID")
    expect(error.name).toBe("InvalidShardIdError")
  })

  test("creates error with string shardId", () => {
    const error = new InvalidShardIdError("invalid")
    expect(error.shardId).toBe("invalid")
  })

  test("formats message correctly", () => {
    const error = new InvalidShardIdError(999)
    expect(error.message).toContain("Invalid shard ID: 999")
    expect(error.message).toContain("valid shard ID")
  })

  test("is instance of NearError", () => {
    const error = new InvalidShardIdError(1)
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidShardIdError)
  })
})

describe("UnknownEpochError", () => {
  test("creates error with blockReference", () => {
    const error = new UnknownEpochError("block123")
    expect(error.blockReference).toBe("block123")
    expect(error.code).toBe("UNKNOWN_EPOCH")
    expect(error.name).toBe("UnknownEpochError")
  })

  test("includes helpful message about archival nodes", () => {
    const error = new UnknownEpochError("block123")
    expect(error.message).toContain("Epoch not found for block: block123")
    expect(error.message).toContain("too old")
    expect(error.message).toContain("archival node")
  })

  test("is instance of NearError", () => {
    const error = new UnknownEpochError("block")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(UnknownEpochError)
  })
})

describe("InvalidNonceError", () => {
  test("creates error with txNonce and akNonce", () => {
    const error = new InvalidNonceError(100, 150)
    expect(error.txNonce).toBe(100)
    expect(error.akNonce).toBe(150)
    expect(error.code).toBe("INVALID_NONCE")
    expect(error.name).toBe("InvalidNonceError")
    expect(error.retryable).toBe(true)
  })

  test("formats message correctly", () => {
    const error = new InvalidNonceError(100, 150)
    expect(error.message).toContain("transaction nonce 100")
    expect(error.message).toContain("access key nonce 150")
    expect(error.message).toContain("must be greater than")
  })

  test("is always retryable", () => {
    const error = new InvalidNonceError(1, 2)
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new InvalidNonceError(1, 2)
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidNonceError)
  })
})

describe("InvalidTransactionError", () => {
  test("creates error with message only", () => {
    const error = new InvalidTransactionError("invalid transaction")
    expect(error.message).toBe("invalid transaction")
    expect(error.code).toBe("INVALID_TRANSACTION")
    expect(error.name).toBe("InvalidTransactionError")
    expect(error.details).toBeUndefined()
    expect(error.shardCongested).toBe(false)
    expect(error.shardStuck).toBe(false)
    expect(error.retryable).toBe(false)
  })

  test("creates error with details", () => {
    const details = { reason: "bad format" }
    const error = new InvalidTransactionError("invalid transaction", details)
    expect(error.details).toEqual(details)
  })

  test("detects ShardCongested and sets retryable", () => {
    const error = new InvalidTransactionError("shard congested", {
      ShardCongested: true,
    })
    expect(error.shardCongested).toBe(true)
    expect(error.shardStuck).toBe(false)
    expect(error.retryable).toBe(true)
  })

  test("detects ShardStuck and sets retryable", () => {
    const error = new InvalidTransactionError("shard stuck", {
      ShardStuck: true,
    })
    expect(error.shardCongested).toBe(false)
    expect(error.shardStuck).toBe(true)
    expect(error.retryable).toBe(true)
  })

  test("detects both ShardCongested and ShardStuck", () => {
    const error = new InvalidTransactionError("shard issues", {
      ShardCongested: true,
      ShardStuck: true,
    })
    expect(error.shardCongested).toBe(true)
    expect(error.shardStuck).toBe(true)
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new InvalidTransactionError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InvalidTransactionError)
  })
})

describe("UnknownReceiptError", () => {
  test("creates error with receiptId", () => {
    const error = new UnknownReceiptError("receipt123")
    expect(error.receiptId).toBe("receipt123")
    expect(error.code).toBe("UNKNOWN_RECEIPT")
    expect(error.name).toBe("UnknownReceiptError")
  })

  test("formats message correctly", () => {
    const error = new UnknownReceiptError("receipt123")
    expect(error.message).toContain("Receipt not found: receipt123")
    expect(error.message).toContain("not have been observed")
  })

  test("is instance of NearError", () => {
    const error = new UnknownReceiptError("receipt")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(UnknownReceiptError)
  })
})

describe("ParseError", () => {
  test("creates error with message only", () => {
    const error = new ParseError("invalid parameters")
    expect(error.code).toBe("PARSE_ERROR")
    expect(error.name).toBe("ParseError")
    expect(error.message).toContain("Request validation failed")
    expect(error.message).toContain("invalid parameters")
  })

  test("creates error with details", () => {
    const details = { field: "accountId" }
    const error = new ParseError("invalid parameters", details)
    expect(error.data).toEqual(details)
  })

  test("is instance of NearError", () => {
    const error = new ParseError("test")
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(ParseError)
  })
})

describe("TimeoutError", () => {
  test("creates error with default message", () => {
    const error = new TimeoutError()
    expect(error.code).toBe("TIMEOUT_ERROR")
    expect(error.name).toBe("TimeoutError")
    expect(error.retryable).toBe(true)
    expect(error.message).toContain("Request timed out")
    expect(error.transactionHash).toBeUndefined()
  })

  test("creates error with custom message", () => {
    const error = new TimeoutError("custom timeout")
    expect(error.message).toBe("custom timeout")
    expect(error.retryable).toBe(true)
  })

  test("creates error with transactionHash", () => {
    const error = new TimeoutError("timeout", "hash123")
    expect(error.transactionHash).toBe("hash123")
  })

  test("is always retryable", () => {
    const error = new TimeoutError()
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new TimeoutError()
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(TimeoutError)
  })
})

describe("InternalServerError", () => {
  test("creates error with default message", () => {
    const error = new InternalServerError()
    expect(error.code).toBe("INTERNAL_ERROR")
    expect(error.name).toBe("InternalServerError")
    expect(error.retryable).toBe(true)
    expect(error.message).toContain("Internal server error")
  })

  test("creates error with custom message", () => {
    const error = new InternalServerError("custom error")
    expect(error.message).toBe("custom error")
    expect(error.retryable).toBe(true)
  })

  test("creates error with details", () => {
    const details = { stack: "error stack" }
    const error = new InternalServerError("error", details)
    expect(error.data).toEqual(details)
  })

  test("is always retryable", () => {
    const error = new InternalServerError()
    expect(error.retryable).toBe(true)
  })

  test("is instance of NearError", () => {
    const error = new InternalServerError()
    expect(error).toBeInstanceOf(NearError)
    expect(error).toBeInstanceOf(InternalServerError)
  })
})
