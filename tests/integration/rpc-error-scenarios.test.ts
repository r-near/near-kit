/**
 * Comprehensive Integration Tests for RPC Error Handling
 *
 * Tests all error types in src/errors/index.ts and error code paths
 * in src/core/rpc/rpc-error-handler.ts
 *
 * Goal: Improve error coverage from 25% to >80%
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Near } from "../../src/core/near.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
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
  InvalidNonceError,
  InvalidShardIdError,
  InvalidTransactionError,
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
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("RPC Error Handling - Comprehensive Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let rpc: RpcClient
  let contractId: string
  let userId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
    })
    rpc = new RpcClient(sandbox.rpcUrl)

    // Deploy guestbook contract for testing
    contractId = `error-test-${Date.now()}.${sandbox.rootAccount.id}`
    const contractWasm = readFileSync(
      resolve(__dirname, "../contracts/guestbook.wasm"),
    )

    const contractKey = generateKey()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(contractId)
      .transfer(contractId, "10 NEAR")
      .addKey(contractKey.publicKey.toString(), { type: "fullAccess" })
      .deployContract(contractId, contractWasm)
      .send()

    // Create user account with limited balance for testing
    userId = `user-${Date.now()}.${sandbox.rootAccount.id}`
    const userKey = generateKey()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(userId)
      .transfer(userId, "2 NEAR") // Limited balance for testing insufficient balance
      .addKey(userKey.publicKey.toString(), { type: "fullAccess" })
      .send()

    // Update keystore
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
        [contractId]: contractKey.secretKey,
        [userId]: userKey.secretKey,
      },
    })

    console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
    console.log(`✓ Contract deployed: ${contractId}`)
    console.log(`✓ User account: ${userId}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  describe("Network Errors", () => {
    test("invalid RPC endpoint throws NetworkError", async () => {
      const badNear = new Near({
        network: "testnet",
        keyStore: {},
      })

      try {
        await badNear.view("wrap.near", "ft_metadata", {})
        throw new Error("Should have thrown NetworkError")
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError)
        if (error instanceof NetworkError) {
          expect(error.code).toBe("NETWORK_ERROR")
          expect(error.name).toBe("NetworkError")
          expect(error.retryable).toBeDefined()
          console.log("✓ NetworkError: invalid endpoint")
        }
      }
    }, 30000)

    test("NetworkError with status code", async () => {
      // This test verifies NetworkError constructor with status code
      const error = new NetworkError("Request failed", 503, true)
      expect(error.statusCode).toBe(503)
      expect(error.retryable).toBe(true)
      expect(error.code).toBe("NETWORK_ERROR")
      console.log("✓ NetworkError with statusCode property")
    })

    test("NetworkError without status code (retryable false)", async () => {
      const error = new NetworkError("Non-retryable error", undefined, false)
      expect(error.statusCode).toBeUndefined()
      expect(error.retryable).toBe(false)
      console.log("✓ NetworkError non-retryable")
    })
  })

  describe("Account Errors", () => {
    test("AccountDoesNotExistError - view account", async () => {
      const nonExistentAccount =
        "this-account-definitely-does-not-exist-12345.near"

      try {
        await rpc.getAccount(nonExistentAccount)
        throw new Error("Should have thrown AccountDoesNotExistError")
      } catch (error) {
        expect(error).toBeInstanceOf(AccountDoesNotExistError)
        if (error instanceof AccountDoesNotExistError) {
          expect(error.code).toBe("ACCOUNT_NOT_FOUND")
          expect(error.name).toBe("AccountDoesNotExistError")
          expect(error.accountId).toBe(nonExistentAccount)
          console.log("✓ AccountDoesNotExistError with accountId property")
        }
      }
    }, 30000)

    test("AccessKeyDoesNotExistError - view access key", async () => {
      // Use a properly formatted but non-existent public key
      const fakePublicKey =
        "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa"

      try {
        await rpc.getAccessKey(sandbox.rootAccount.id, fakePublicKey)
        throw new Error("Should have thrown AccessKeyDoesNotExistError")
      } catch (error) {
        expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
        if (error instanceof AccessKeyDoesNotExistError) {
          expect(error.code).toBe("ACCESS_KEY_NOT_FOUND")
          expect(error.name).toBe("AccessKeyDoesNotExistError")
          expect(error.accountId).toBe(sandbox.rootAccount.id)
          expect(error.publicKey).toBe(fakePublicKey)
          console.log(
            "✓ AccessKeyDoesNotExistError with accountId and publicKey",
          )
        }
      }
    }, 30000)

    test("InvalidAccountIdError - with reason", () => {
      const error = new InvalidAccountIdError(
        "invalid..account",
        "consecutive dots not allowed",
      )
      expect(error.code).toBe("INVALID_ACCOUNT_ID")
      expect(error.name).toBe("InvalidAccountIdError")
      expect(error.accountId).toBe("invalid..account")
      expect(error.message).toContain("consecutive dots not allowed")
      console.log("✓ InvalidAccountIdError with reason")
    })

    test("InvalidAccountIdError - without reason", () => {
      const error = new InvalidAccountIdError("bad-account-@#$")
      expect(error.accountId).toBe("bad-account-@#$")
      expect(error.message).toContain("Invalid account ID")
      expect(error.message).not.toContain(" - ")
      console.log("✓ InvalidAccountIdError without reason")
    })

    test("InvalidAccountError", () => {
      const error = new InvalidAccountError("invalid-format-account")
      expect(error.code).toBe("INVALID_ACCOUNT")
      expect(error.name).toBe("InvalidAccountError")
      expect(error.accountId).toBe("invalid-format-account")
      console.log("✓ InvalidAccountError with accountId property")
    })
  })

  describe("Transaction Errors", () => {
    test("InsufficientBalanceError - not enough for transfer", async () => {
      try {
        // Try to send more NEAR than the account has
        await near
          .transaction(userId)
          .transfer(sandbox.rootAccount.id, "100 NEAR") // User only has 2 NEAR
          .send()

        throw new Error("Should have thrown error")
      } catch (error) {
        // May throw InsufficientBalanceError or InvalidTransactionError depending on validation
        expect(
          error instanceof InsufficientBalanceError ||
            error instanceof InvalidTransactionError,
        ).toBe(true)
        console.log(
          `✓ Insufficient balance detected: ${(error as Error).constructor.name}`,
        )
      }
    }, 30000)

    test("InsufficientBalanceError - constructor properties", () => {
      const error = new InsufficientBalanceError("10.5", "2.3")
      expect(error.code).toBe("INSUFFICIENT_BALANCE")
      expect(error.name).toBe("InsufficientBalanceError")
      expect(error.required).toBe("10.5")
      expect(error.available).toBe("2.3")
      expect(error.message).toContain("required 10.5 NEAR")
      expect(error.message).toContain("available 2.3 NEAR")
      console.log("✓ InsufficientBalanceError with required and available")
    })

    test("InvalidNonceError - properties and retryable", () => {
      const error = new InvalidNonceError(100, 105)
      expect(error.code).toBe("INVALID_NONCE")
      expect(error.name).toBe("InvalidNonceError")
      expect(error.txNonce).toBe(100)
      expect(error.akNonce).toBe(105)
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("transaction nonce 100")
      expect(error.message).toContain("access key nonce 105")
      console.log(
        "✓ InvalidNonceError with nonce properties and retryable flag",
      )
    })

    test("InvalidTransactionError - with ShardCongested", () => {
      const error = new InvalidTransactionError("Shard is congested", {
        ShardCongested: true,
      })
      expect(error.code).toBe("INVALID_TRANSACTION")
      expect(error.name).toBe("InvalidTransactionError")
      expect(error.shardCongested).toBe(true)
      expect(error.shardStuck).toBe(false)
      expect(error.retryable).toBe(true) // ShardCongested is retryable
      expect(error.details).toEqual({ ShardCongested: true })
      console.log("✓ InvalidTransactionError with ShardCongested (retryable)")
    })

    test("InvalidTransactionError - with ShardStuck", () => {
      const error = new InvalidTransactionError("Shard is stuck", {
        ShardStuck: true,
      })
      expect(error.shardCongested).toBe(false)
      expect(error.shardStuck).toBe(true)
      expect(error.retryable).toBe(true) // ShardStuck is retryable
      console.log("✓ InvalidTransactionError with ShardStuck (retryable)")
    })

    test("InvalidTransactionError - non-retryable", () => {
      const error = new InvalidTransactionError("Invalid signature", {
        InvalidSignature: true,
      })
      expect(error.shardCongested).toBe(false)
      expect(error.shardStuck).toBe(false)
      expect(error.retryable).toBe(false) // Non-retryable error
      console.log("✓ InvalidTransactionError non-retryable")
    })

    test("TransactionTimeoutError", () => {
      const txHash = "ABC123XYZ"
      const error = new TransactionTimeoutError(txHash)
      expect(error.code).toBe("TRANSACTION_TIMEOUT")
      expect(error.name).toBe("TransactionTimeoutError")
      expect(error.transactionHash).toBe(txHash)
      expect(error.message).toContain(txHash)
      console.log("✓ TransactionTimeoutError with transactionHash")
    })
  })

  describe("Contract Errors", () => {
    test("FunctionCallError - method not found", async () => {
      try {
        await near
          .transaction(userId)
          .functionCall(contractId, "method_that_does_not_exist", {})
          .send()

        throw new Error("Should have thrown FunctionCallError")
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionCallError)
        if (error instanceof FunctionCallError) {
          expect(error.code).toBe("FUNCTION_CALL_ERROR")
          expect(error.name).toBe("FunctionCallError")
          expect(error.contractId).toBe(contractId)
          expect(error.methodName).toBe("method_that_does_not_exist")
          expect(error.panic).toBeDefined()
          expect(error.logs).toBeDefined()
          expect(Array.isArray(error.logs)).toBe(true)
          console.log("✓ FunctionCallError with all properties")
        }
      }
    }, 30000)

    test("FunctionCallError - deserialization error (missing params)", async () => {
      try {
        await near
          .transaction(userId)
          .functionCall(contractId, "add_message", {}) // Missing 'text' parameter
          .send()

        throw new Error("Should have thrown FunctionCallError")
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionCallError)
        if (error instanceof FunctionCallError) {
          expect(error.panic).toContain("deserialize")
          console.log("✓ FunctionCallError - deserialization error")
        }
      }
    }, 30000)

    test("FunctionCallError - constructor without methodName", () => {
      const error = new FunctionCallError(
        "test.near",
        undefined,
        "Panic message",
        ["log1", "log2"],
      )
      expect(error.contractId).toBe("test.near")
      expect(error.methodName).toBeUndefined()
      expect(error.panic).toBe("Panic message")
      expect(error.logs).toEqual(["log1", "log2"])
      expect(error.message).not.toContain(".undefined")
      console.log("✓ FunctionCallError without methodName")
    })

    test("FunctionCallError - constructor without panic", () => {
      const error = new FunctionCallError("test.near", "some_method", undefined)
      expect(error.panic).toBeUndefined()
      expect(error.message).toContain("test.near.some_method")
      expect(error.message).not.toContain(" - undefined")
      console.log("✓ FunctionCallError without panic message")
    })

    test("ContractNotDeployedError - view call to account without contract", async () => {
      try {
        // Try to call a view method on an account without a contract
        await near.view(userId, "some_method", {})
        throw new Error("Should have thrown error")
      } catch (error) {
        // Could be ContractNotDeployedError or FunctionCallError
        expect(
          error instanceof ContractNotDeployedError ||
            error instanceof FunctionCallError,
        ).toBe(true)
        console.log(`✓ No contract error: ${(error as Error).constructor.name}`)
      }
    }, 30000)

    test("ContractNotDeployedError - constructor", () => {
      const error = new ContractNotDeployedError("no-contract.near")
      expect(error.code).toBe("NO_CONTRACT_CODE")
      expect(error.name).toBe("ContractNotDeployedError")
      expect(error.accountId).toBe("no-contract.near")
      expect(error.message).toContain("no-contract.near")
      console.log("✓ ContractNotDeployedError with accountId")
    })

    test("ContractStateTooLargeError", () => {
      const error = new ContractStateTooLargeError("large-contract.near")
      expect(error.code).toBe("TOO_LARGE_CONTRACT_STATE")
      expect(error.name).toBe("ContractStateTooLargeError")
      expect(error.accountId).toBe("large-contract.near")
      expect(error.message).toContain("too large")
      expect(error.message).toContain("50kb")
      console.log("✓ ContractStateTooLargeError with accountId")
    })

    test("ContractExecutionError - with methodName", () => {
      const error = new ContractExecutionError("contract.near", "view_method", {
        gasUsed: "300000000000",
      })
      expect(error.code).toBe("CONTRACT_EXECUTION_ERROR")
      expect(error.name).toBe("ContractExecutionError")
      expect(error.contractId).toBe("contract.near")
      expect(error.methodName).toBe("view_method")
      expect(error.details).toEqual({ gasUsed: "300000000000" })
      expect(error.message).toContain("contract.near.view_method")
      console.log("✓ ContractExecutionError with methodName and details")
    })

    test("ContractExecutionError - without methodName", () => {
      const error = new ContractExecutionError("contract.near", undefined, {
        reason: "unknown",
      })
      expect(error.methodName).toBeUndefined()
      expect(error.message).toContain("contract.near")
      expect(error.message).not.toContain(".undefined")
      console.log("✓ ContractExecutionError without methodName")
    })

    test("ContractExecutionError - without details", () => {
      const error = new ContractExecutionError("contract.near", "method")
      expect(error.details).toBeUndefined()
      console.log("✓ ContractExecutionError without details")
    })

    test("GasLimitExceededError", () => {
      const error = new GasLimitExceededError("300000000000", "200000000000")
      expect(error.code).toBe("GAS_LIMIT_EXCEEDED")
      expect(error.name).toBe("GasLimitExceededError")
      expect(error.gasUsed).toBe("300000000000")
      expect(error.gasLimit).toBe("200000000000")
      expect(error.message).toContain("used 300000000000")
      expect(error.message).toContain("limit 200000000000")
      console.log("✓ GasLimitExceededError with gas properties")
    })
  })

  describe("Block / Chunk / Epoch Errors", () => {
    test("UnknownBlockError", () => {
      const error = new UnknownBlockError("12345")
      expect(error.code).toBe("UNKNOWN_BLOCK")
      expect(error.name).toBe("UnknownBlockError")
      expect(error.blockReference).toBe("12345")
      expect(error.message).toContain("12345")
      expect(error.message).toContain("garbage-collected")
      expect(error.message).toContain("archival")
      console.log("✓ UnknownBlockError with blockReference")
    })

    test("UnknownChunkError", () => {
      const error = new UnknownChunkError("chunk-xyz")
      expect(error.code).toBe("UNKNOWN_CHUNK")
      expect(error.name).toBe("UnknownChunkError")
      expect(error.chunkReference).toBe("chunk-xyz")
      expect(error.message).toContain("chunk-xyz")
      expect(error.message).toContain("archival")
      console.log("✓ UnknownChunkError with chunkReference")
    })

    test("UnknownEpochError", () => {
      const error = new UnknownEpochError("block-ref-123")
      expect(error.code).toBe("UNKNOWN_EPOCH")
      expect(error.name).toBe("UnknownEpochError")
      expect(error.blockReference).toBe("block-ref-123")
      expect(error.message).toContain("block-ref-123")
      expect(error.message).toContain("archival")
      console.log("✓ UnknownEpochError with blockReference")
    })

    test("InvalidShardIdError - number", () => {
      const error = new InvalidShardIdError(999)
      expect(error.code).toBe("INVALID_SHARD_ID")
      expect(error.name).toBe("InvalidShardIdError")
      expect(error.shardId).toBe(999)
      expect(error.message).toContain("999")
      console.log("✓ InvalidShardIdError with numeric shardId")
    })

    test("InvalidShardIdError - string", () => {
      const error = new InvalidShardIdError("invalid-shard")
      expect(error.shardId).toBe("invalid-shard")
      console.log("✓ InvalidShardIdError with string shardId")
    })

    test("UnknownReceiptError", () => {
      const error = new UnknownReceiptError("receipt-123abc")
      expect(error.code).toBe("UNKNOWN_RECEIPT")
      expect(error.name).toBe("UnknownReceiptError")
      expect(error.receiptId).toBe("receipt-123abc")
      expect(error.message).toContain("receipt-123abc")
      console.log("✓ UnknownReceiptError with receiptId")
    })
  })

  describe("Node / Shard Errors", () => {
    test("ShardUnavailableError - with message", () => {
      const error = new ShardUnavailableError("Shard 3 not tracked")
      expect(error.code).toBe("UNAVAILABLE_SHARD")
      expect(error.name).toBe("ShardUnavailableError")
      expect(error.retryable).toBe(true)
      expect(error.message).toBe("Shard 3 not tracked")
      console.log("✓ ShardUnavailableError with custom message")
    })

    test("ShardUnavailableError - default message", () => {
      const error = new ShardUnavailableError()
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("not tracked")
      console.log("✓ ShardUnavailableError with default message")
    })

    test("NodeNotSyncedError - with message", () => {
      const error = new NodeNotSyncedError("Node syncing at 50%")
      expect(error.code).toBe("NOT_SYNCED")
      expect(error.name).toBe("NodeNotSyncedError")
      expect(error.retryable).toBe(true)
      expect(error.message).toBe("Node syncing at 50%")
      console.log("✓ NodeNotSyncedError with custom message")
    })

    test("NodeNotSyncedError - default message", () => {
      const error = new NodeNotSyncedError()
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("syncing")
      console.log("✓ NodeNotSyncedError with default message")
    })
  })

  describe("Request / Timeout Errors", () => {
    test("ParseError - with details", () => {
      const error = new ParseError("Invalid block_id format", {
        field: "block_id",
      })
      expect(error.code).toBe("PARSE_ERROR")
      expect(error.name).toBe("ParseError")
      expect(error.message).toContain("Invalid block_id format")
      expect(error.message).toContain("Request validation failed")
      expect(error.data).toEqual({ field: "block_id" })
      console.log("✓ ParseError with details")
    })

    test("ParseError - without details", () => {
      const error = new ParseError("Malformed JSON")
      expect(error.data).toBeUndefined()
      console.log("✓ ParseError without details")
    })

    test("TimeoutError - with transaction hash", () => {
      const error = new TimeoutError("Request timeout", "tx-hash-abc")
      expect(error.code).toBe("TIMEOUT_ERROR")
      expect(error.name).toBe("TimeoutError")
      expect(error.retryable).toBe(true)
      expect(error.transactionHash).toBe("tx-hash-abc")
      console.log("✓ TimeoutError with transactionHash")
    })

    test("TimeoutError - without transaction hash", () => {
      const error = new TimeoutError()
      expect(error.transactionHash).toBeUndefined()
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("timed out")
      console.log("✓ TimeoutError without transactionHash (default message)")
    })

    test("TimeoutError - custom message without hash", () => {
      const error = new TimeoutError("Connection timeout")
      expect(error.transactionHash).toBeUndefined()
      expect(error.message).toBe("Connection timeout")
      console.log("✓ TimeoutError with custom message, no hash")
    })

    test("InternalServerError - with details", () => {
      const error = new InternalServerError("Database connection failed", {
        dbError: "timeout",
      })
      expect(error.code).toBe("INTERNAL_ERROR")
      expect(error.name).toBe("InternalServerError")
      expect(error.retryable).toBe(true)
      expect(error.message).toBe("Database connection failed")
      expect(error.data).toEqual({ dbError: "timeout" })
      console.log("✓ InternalServerError with details")
    })

    test("InternalServerError - without details", () => {
      const error = new InternalServerError()
      expect(error.data).toBeUndefined()
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("Internal server error")
      console.log("✓ InternalServerError without details (default message)")
    })
  })

  describe("Signature / Wallet Errors", () => {
    test("SignatureError", () => {
      const error = new SignatureError("Invalid signature format")
      expect(error.code).toBe("SIGNATURE_ERROR")
      expect(error.name).toBe("SignatureError")
      expect(error.message).toBe("Invalid signature format")
      console.log("✓ SignatureError")
    })

    test("WalletError", () => {
      const error = new WalletError("User rejected transaction")
      expect(error.code).toBe("WALLET_ERROR")
      expect(error.name).toBe("WalletError")
      expect(error.message).toBe("User rejected transaction")
      console.log("✓ WalletError")
    })
  })

  describe("RPC Error Handler Edge Cases", () => {
    test("parseQueryError - contract method not found", async () => {
      try {
        await near.view(contractId, "nonexistent_method", {})
        throw new Error("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionCallError)
        console.log("✓ parseQueryError handles contract method errors")
      }
    }, 30000)

    test("Multiple error properties verification", () => {
      // Verify that error constructors properly set all properties
      const errors = [
        new InsufficientBalanceError("10", "5"),
        new InvalidNonceError(100, 105),
        new GasLimitExceededError("300", "200"),
        new TransactionTimeoutError("hash123"),
        new AccountDoesNotExistError("test.near"),
        new AccessKeyDoesNotExistError("test.near", "ed25519:ABC"),
        new InvalidAccountIdError("bad..account", "double dots"),
        new UnknownBlockError("12345"),
        new UnknownChunkError("chunk-xyz"),
        new UnknownEpochError("epoch-ref"),
        new InvalidShardIdError(999),
        new UnknownReceiptError("receipt-123"),
        new ContractNotDeployedError("contract.near"),
        new ContractStateTooLargeError("large.near"),
        new ShardUnavailableError("Custom message"),
        new NodeNotSyncedError("Syncing..."),
        new ParseError("Parse failed", { field: "test" }),
        new TimeoutError("Timeout", "tx-hash"),
        new InternalServerError("Server error", { code: 500 }),
        new SignatureError("Bad signature"),
        new WalletError("Wallet error"),
      ]

      for (const error of errors) {
        expect(error.code).toBeDefined()
        expect(error.name).toBeDefined()
        expect(error.message).toBeDefined()
        expect(error.message.length).toBeGreaterThan(0)
      }

      console.log("✓ All error types have required properties")
    })

    test("Error inheritance chain", () => {
      const error = new FunctionCallError("test.near", "method", "panic")
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).constructor.name).toBe("FunctionCallError")
      console.log("✓ Error inheritance chain verified")
    })
  })
})
