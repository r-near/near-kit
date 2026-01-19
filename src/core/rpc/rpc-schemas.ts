/**
 * Zod schemas for NEAR RPC responses
 * Provides runtime validation and type inference
 */

import { z } from "zod"

// ==================== Permissions ====================

/**
 * Function call permission details schema
 */
export const FunctionCallPermissionDetailsSchema = z.object({
  receiver_id: z.string(),
  method_names: z.array(z.string()),
  allowance: z.string().nullable().optional(),
})

/**
 * Access key permission schema
 * Either "FullAccess" string or object with FunctionCall details
 */
export const AccessKeyPermissionSchema = z.union([
  z.literal("FullAccess"),
  z.object({
    FunctionCall: FunctionCallPermissionDetailsSchema,
  }),
])

// ==================== RPC Response Schemas ====================

/**
 * View function call result schema
 */
export const ViewFunctionCallResultSchema = z.object({
  result: z.array(z.number()),
  logs: z.array(z.string()),
  block_height: z.number(),
  block_hash: z.string(),
})

/**
 * Account view schema
 */
export const AccountViewSchema = z.object({
  amount: z.string(),
  locked: z.string(),
  code_hash: z.string(),
  storage_usage: z.number(),
  storage_paid_at: z.number(),
  block_height: z.number(),
  block_hash: z.string(),
})

/**
 * Access key view schema
 */
export const AccessKeyViewSchema = z.object({
  nonce: z.number(),
  permission: AccessKeyPermissionSchema,
  block_height: z.number(),
  block_hash: z.string(),
})

/**
 * Access key info view schema
 */
export const AccessKeyInfoViewSchema = z.object({
  public_key: z.string(),
  access_key: AccessKeyViewSchema,
})

/**
 * Block header view schema
 */
export const BlockHeaderViewSchema = z.object({
  height: z.number(),
  prev_height: z.number().nullable().optional(),
  epoch_id: z.string(),
  next_epoch_id: z.string(),
  hash: z.string(),
  prev_hash: z.string(),
  prev_state_root: z.string(),
  chunk_receipts_root: z.string(),
  chunk_headers_root: z.string(),
  chunk_tx_root: z.string(),
  outcome_root: z.string(),
  chunks_included: z.number(),
  challenges_root: z.string(),
  timestamp: z.number(),
  timestamp_nanosec: z.string(),
  random_value: z.string(),
  validator_proposals: z.array(z.any()),
  chunk_mask: z.array(z.boolean()),
  gas_price: z.string(),
  block_ordinal: z.number().nullable().optional(),
  total_supply: z.string(),
  challenges_result: z.array(z.any()),
  last_final_block: z.string(),
  last_ds_final_block: z.string(),
  next_bp_hash: z.string(),
  block_merkle_root: z.string(),
  epoch_sync_data_hash: z.string().nullable().optional(),
  approvals: z.array(z.string().nullable()),
  signature: z.string(),
  latest_protocol_version: z.number(),
})

/**
 * Chunk header view schema (simplified)
 */
export const ChunkHeaderViewSchema = z.object({
  chunk_hash: z.string(),
  prev_block_hash: z.string(),
  outcome_root: z.string(),
  prev_state_root: z.string(),
  encoded_merkle_root: z.string(),
  encoded_length: z.number(),
  height_created: z.number(),
  height_included: z.number(),
  shard_id: z.number(),
  gas_used: z.number(),
  gas_limit: z.number(),
  validator_reward: z.string(),
  balance_burnt: z.string(),
  outgoing_receipts_root: z.string(),
  tx_root: z.string(),
  validator_proposals: z.array(z.any()),
  signature: z.string(),
})

/**
 * Block view schema
 */
export const BlockViewSchema = z.object({
  author: z.string(),
  header: BlockHeaderViewSchema,
  chunks: z.array(ChunkHeaderViewSchema),
})

/**
 * Status response schema
 */
export const StatusResponseSchema = z.object({
  version: z.object({
    version: z.string(),
    build: z.string(),
    commit: z.string().optional(),
    rustc_version: z.string().optional(),
  }),
  chain_id: z.string(),
  genesis_hash: z.string(),
  protocol_version: z.number(),
  latest_protocol_version: z.number(),
  rpc_addr: z.string(),
  node_public_key: z.string(),
  node_key: z.string().nullable(),
  validator_account_id: z.string().nullable(),
  validator_public_key: z.string().nullable(),
  validators: z.array(
    z.object({
      account_id: z.string(),
    }),
  ),
  sync_info: z.object({
    latest_block_hash: z.string(),
    latest_block_height: z.number(),
    latest_state_root: z.string(),
    latest_block_time: z.string(),
    syncing: z.boolean(),
    earliest_block_hash: z.string().optional(),
    earliest_block_height: z.number().optional(),
    earliest_block_time: z.string().optional(),
    epoch_id: z.string().optional(),
    epoch_start_height: z.number().optional(),
  }),
  uptime_sec: z.number().optional(),
})

/**
 * Gas price response schema
 */
export const GasPriceResponseSchema = z.object({
  gas_price: z.string(),
})

/**
 * Access key list response schema
 */
export const AccessKeyListResponseSchema = z.object({
  block_hash: z.string(),
  block_height: z.number(),
  keys: z.array(
    z.object({
      public_key: z.string(),
      access_key: z.object({
        nonce: z.number(),
        permission: AccessKeyPermissionSchema,
      }),
    }),
  ),
})

/**
 * RPC error response schema
 * Follows the NEAR RPC error structure with name, cause, code, message, and data
 */
export const RpcErrorResponseSchema = z.object({
  name: z.string(), // ERROR_TYPE (e.g., "HANDLER_ERROR", "REQUEST_VALIDATION_ERROR", "INTERNAL_ERROR")
  code: z.number(), // Legacy field (e.g., -32000)
  message: z.string(), // Error message
  data: z.any().optional(), // Optional additional data (can be string or object with error details)
  cause: z
    .object({
      name: z.string(), // ERROR_CAUSE (e.g., "UNKNOWN_ACCOUNT", "TIMEOUT_ERROR")
      info: z
        .object({
          // Common fields
          requested_account_id: z.string().optional(),
          contract_id: z.string().optional(),
          method_name: z.string().optional(),
          // Transaction-specific fields
          ShardCongested: z.boolean().optional(),
          ShardStuck: z.boolean().optional(),
        })
        .catchall(z.any()) // Allow any other fields
        .optional(),
    })
    .optional(),
})

// ==================== Transaction Schemas ====================

/**
 * Transaction execution status enum
 */
export const TxExecutionStatusSchema = z.enum([
  "NONE",
  "INCLUDED",
  "EXECUTED_OPTIMISTIC",
  "INCLUDED_FINAL",
  "EXECUTED",
  "FINAL",
])

/**
 * Execution status - can be success with value/receipt or failure
 *
 * Variants returned depend on waitUntil level:
 * - NONE/INCLUDED: Unknown or Pending (execution not started/incomplete)
 * - EXECUTED_OPTIMISTIC/EXECUTED/FINAL: SuccessValue, SuccessReceiptId, or Failure
 */
export const ExecutionStatusSchema = z.union([
  z.literal("Unknown"),
  z.literal("Pending"),
  z.object({ SuccessValue: z.string() }),
  z.object({ SuccessReceiptId: z.string() }),
  z.object({
    Failure: z
      .object({
        error_message: z.string().optional(),
        error_type: z.string().optional(),
      })
      .catchall(z.any()),
  }),
])

/**
 * Gas profile entry (for metadata)
 */
export const GasProfileEntrySchema = z
  .object({
    cost: z.string().optional(),
    cost_category: z.string().optional(),
    gas_used: z.string().optional(),
  })
  .catchall(z.any())

/**
 * Execution metadata
 */
export const ExecutionMetadataSchema = z.object({
  version: z.number(),
  gas_profile: z.array(GasProfileEntrySchema).nullable().optional(),
})

/**
 * Execution outcome
 */
export const ExecutionOutcomeSchema = z.object({
  logs: z.array(z.string()),
  receipt_ids: z.array(z.string()),
  gas_burnt: z.number(),
  tokens_burnt: z.string(),
  executor_id: z.string(),
  status: ExecutionStatusSchema,
  metadata: ExecutionMetadataSchema.optional(),
})

/**
 * Merkle path item for cryptographic proofs
 */
export const MerklePathItemSchema = z.object({
  hash: z.string(),
  direction: z.enum(["Left", "Right"]),
})

/**
 * Execution outcome with ID (used in transaction results)
 */
export const ExecutionOutcomeWithIdSchema = z.object({
  id: z.string(),
  outcome: ExecutionOutcomeSchema,
  block_hash: z.string(),
  proof: z.array(MerklePathItemSchema),
})

/**
 * Action schemas - matches RPC response format
 * Note: RPC returns actions with no parameters as strings (e.g., "CreateAccount")
 * instead of objects (e.g., { "CreateAccount": {} })
 */
export const ActionSchema = z.union([
  // CreateAccount can be either a string or an object (when no params, RPC returns string)
  z.literal("CreateAccount"),
  z.object({ CreateAccount: z.object({}) }),
  z.object({ Transfer: z.object({ deposit: z.string() }) }),
  z.object({
    FunctionCall: z.object({
      method_name: z.string(),
      args: z.string(),
      gas: z.number(),
      deposit: z.string(),
    }),
  }),
  z.object({
    DeployContract: z.object({
      code: z.string(), // base64 encoded
    }),
  }),
  z.object({
    DeployGlobalContractByAccountId: z.object({
      code: z.string(), // base64 encoded contract code
    }),
  }),
  z.object({
    DeployGlobalContractByCodeHash: z.object({
      code: z.string(), // base64 encoded contract code
    }),
  }),
  z.object({
    Stake: z.object({
      stake: z.string(),
      public_key: z.string(),
    }),
  }),
  z.object({
    AddKey: z.object({
      public_key: z.string(),
      access_key: z.object({
        nonce: z.number(),
        permission: AccessKeyPermissionSchema,
      }),
    }),
  }),
  z.object({
    DeleteKey: z.object({
      public_key: z.string(),
    }),
  }),
  z.object({
    DeleteAccount: z.object({
      beneficiary_id: z.string(),
    }),
  }),
  z.object({
    UseGlobalContractByAccountId: z.object({
      account_id: z.string(),
    }),
  }),
  z.object({
    UseGlobalContractByCodeHash: z.object({
      code_hash: z.string(),
    }),
  }),
  z.object({
    Delegate: z.object({
      delegate_action: z.object({
        sender_id: z.string(),
        receiver_id: z.string(),
        actions: z.array(z.any()),
        nonce: z.number(),
        max_block_height: z.number(),
        public_key: z.string(),
      }),
      signature: z.string(),
    }),
  }),
  z.object({
    DeterministicStateInit: z.object({
      // Note: The RPC only returns deposit, not state_init data
      // StateInit is only needed during transaction construction
      deposit: z.string(), // yoctoNEAR as string
    }),
  }),
])

/**
 * Transaction schema (as returned by RPC)
 */
export const TransactionSchema = z.object({
  signer_id: z.string(),
  public_key: z.string(),
  nonce: z.number(),
  receiver_id: z.string(),
  actions: z.array(ActionSchema),
  signature: z.string(),
  hash: z.string(),
  priority_fee: z.number().optional(),
})

/**
 * Minimal transaction schema for NONE/INCLUDED/INCLUDED_FINAL responses.
 *
 * This contains just enough information for transaction tracking:
 * - hash: Transaction hash for lookups
 * - signer_id: Account that signed the transaction
 * - receiver_id: Account receiving the transaction
 * - nonce: Transaction nonce for debugging
 *
 * Note: The client library injects this object for NONE/INCLUDED/INCLUDED_FINAL
 * responses to ensure transaction.hash is always available.
 */
export const MinimalTransactionSchema = z.object({
  hash: z.string(),
  signer_id: z.string(),
  receiver_id: z.string(),
  nonce: z.number(),
})

/**
 * Final execution outcome schema - the response from send_tx
 *
 * Uses discriminated union based on final_execution_status for type safety:
 * - NONE: Transaction submitted but not executed yet (minimal response with transaction hash)
 * - INCLUDED: Transaction included in block (minimal response with transaction hash)
 * - EXECUTED_OPTIMISTIC/EXECUTED/FINAL: Transaction executed (full response)
 *
 * Note: For NONE/INCLUDED/INCLUDED_FINAL, the RPC doesn't return transaction details,
 * but the client library injects a minimal transaction object to ensure hash tracking.
 */
export const FinalExecutionOutcomeSchema = z.discriminatedUnion(
  "final_execution_status",
  [
    // NONE: Transaction submitted, no execution yet (transaction is injected client-side)
    z.object({
      final_execution_status: z.literal("NONE"),
      transaction: MinimalTransactionSchema.optional(),
    }),
    // INCLUDED: Transaction in block (transaction is injected client-side)
    z.object({
      final_execution_status: z.literal("INCLUDED"),
      transaction: MinimalTransactionSchema.optional(),
    }),
    // INCLUDED_FINAL: Alternative name for INCLUDED with finality (transaction is injected client-side)
    z.object({
      final_execution_status: z.literal("INCLUDED_FINAL"),
      transaction: MinimalTransactionSchema.optional(),
    }),
    // EXECUTED_OPTIMISTIC: Executed but not finalized
    z.object({
      final_execution_status: z.literal("EXECUTED_OPTIMISTIC"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: z.array(ExecutionOutcomeWithIdSchema),
    }),
    // EXECUTED: Executed (legacy)
    z.object({
      final_execution_status: z.literal("EXECUTED"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: z.array(ExecutionOutcomeWithIdSchema),
    }),
    // FINAL: Fully finalized
    z.object({
      final_execution_status: z.literal("FINAL"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: z.array(ExecutionOutcomeWithIdSchema),
    }),
  ],
)

/**
 * Receipt schema (for EXPERIMENTAL_tx_status)
 */
export const ReceiptSchema = z.object({
  predecessor_id: z.string(),
  receiver_id: z.string(),
  receipt_id: z.string(),
  receipt: z.union([
    z.object({
      Action: z.object({
        signer_id: z.string(),
        signer_public_key: z.string(),
        gas_price: z.string(),
        output_data_receivers: z.array(z.any()),
        input_data_ids: z.array(z.string()),
        actions: z.array(ActionSchema),
        is_promise_yield: z.boolean().optional(),
      }),
    }),
    z.object({
      Data: z.object({
        data_id: z.string(),
        data: z.string().nullable().optional(),
      }),
    }),
  ]),
  priority: z.number().optional(),
})

/**
 * Final execution outcome with receipts (EXPERIMENTAL_tx_status response)
 * Uses intersection since we can't extend discriminated unions
 */
export const FinalExecutionOutcomeWithReceiptsSchema = z.intersection(
  FinalExecutionOutcomeSchema,
  z.object({
    receipts: z.array(ReceiptSchema),
  }),
)

// ==================== Type Inference ====================

/**
 * Infer TypeScript types from schemas
 */
export type FunctionCallPermissionDetails = z.infer<
  typeof FunctionCallPermissionDetailsSchema
>
export type AccessKeyPermission = z.infer<typeof AccessKeyPermissionSchema>
export type ViewFunctionCallResult = z.infer<
  typeof ViewFunctionCallResultSchema
>
export type AccountView = z.infer<typeof AccountViewSchema>
export type AccessKeyView = z.infer<typeof AccessKeyViewSchema>
export type AccessKeyInfoView = z.infer<typeof AccessKeyInfoViewSchema>
export type BlockHeaderView = z.infer<typeof BlockHeaderViewSchema>
export type ChunkHeaderView = z.infer<typeof ChunkHeaderViewSchema>
export type BlockView = z.infer<typeof BlockViewSchema>
export type StatusResponse = z.infer<typeof StatusResponseSchema>
export type GasPriceResponse = z.infer<typeof GasPriceResponseSchema>
export type AccessKeyListResponse = z.infer<typeof AccessKeyListResponseSchema>
export type RpcErrorResponse = z.infer<typeof RpcErrorResponseSchema>

/**
 * Transaction-related types
 */
export type TxExecutionStatus = z.infer<typeof TxExecutionStatusSchema>
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>
export type ExecutionOutcome = z.infer<typeof ExecutionOutcomeSchema>
export type MerklePathItem = z.infer<typeof MerklePathItemSchema>
export type ExecutionOutcomeWithId = z.infer<
  typeof ExecutionOutcomeWithIdSchema
>
export type RpcAction = z.infer<typeof ActionSchema>
export type RpcTransaction = z.infer<typeof TransactionSchema>
export type FinalExecutionOutcome = z.infer<typeof FinalExecutionOutcomeSchema>
export type Receipt = z.infer<typeof ReceiptSchema>
export type FinalExecutionOutcomeWithReceipts = z.infer<
  typeof FinalExecutionOutcomeWithReceiptsSchema
>

/**
 * Mapped type for looking up the specific FinalExecutionOutcome variant based on wait mode.
 * This enables precise type inference when using waitUntil parameter.
 *
 * @example
 * ```typescript
 * type NoneResult = FinalExecutionOutcomeMap["NONE"]
 * // { final_execution_status: "NONE" }
 *
 * type FinalResult = FinalExecutionOutcomeMap["FINAL"]
 * // { final_execution_status: "FINAL"; status: ...; transaction: ...; ... }
 * ```
 */
export type FinalExecutionOutcomeMap = {
  NONE: Extract<FinalExecutionOutcome, { final_execution_status: "NONE" }>
  INCLUDED: Extract<
    FinalExecutionOutcome,
    { final_execution_status: "INCLUDED" }
  >
  INCLUDED_FINAL: Extract<
    FinalExecutionOutcome,
    { final_execution_status: "INCLUDED_FINAL" }
  >
  EXECUTED_OPTIMISTIC: Extract<
    FinalExecutionOutcome,
    { final_execution_status: "EXECUTED_OPTIMISTIC" }
  >
  EXECUTED: Extract<
    FinalExecutionOutcome,
    { final_execution_status: "EXECUTED" }
  >
  FINAL: Extract<FinalExecutionOutcome, { final_execution_status: "FINAL" }>
}

/**
 * Mapped type for looking up the specific FinalExecutionOutcomeWithReceipts variant based on wait mode.
 * This enables precise type inference when using waitUntil parameter with EXPERIMENTAL_tx_status.
 *
 * @example
 * ```typescript
 * type NoneResult = FinalExecutionOutcomeWithReceiptsMap["NONE"]
 * // { final_execution_status: "NONE"; receipts: Receipt[] }
 *
 * type FinalResult = FinalExecutionOutcomeWithReceiptsMap["FINAL"]
 * // { final_execution_status: "FINAL"; status: ...; transaction: ...; receipts: Receipt[]; ... }
 * ```
 */
export type FinalExecutionOutcomeWithReceiptsMap = {
  NONE: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "NONE" }
  >
  INCLUDED: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "INCLUDED" }
  >
  INCLUDED_FINAL: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "INCLUDED_FINAL" }
  >
  EXECUTED_OPTIMISTIC: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "EXECUTED_OPTIMISTIC" }
  >
  EXECUTED: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "EXECUTED" }
  >
  FINAL: Extract<
    FinalExecutionOutcomeWithReceipts,
    { final_execution_status: "FINAL" }
  >
}
