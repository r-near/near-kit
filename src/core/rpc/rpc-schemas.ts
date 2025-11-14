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
  data: z.string().optional(), // Optional additional data
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
 */
export const ExecutionStatusSchema = z.union([
  z.object({ SuccessValue: z.string() }),
  z.object({ SuccessReceiptId: z.string() }),
  z.object({
    Failure: z.object({
      error_message: z.string().optional(),
      error_type: z.string().optional(),
    }).catchall(z.any()),
  }),
])

/**
 * Gas profile entry (for metadata)
 */
export const GasProfileEntrySchema = z.object({
  cost: z.string().optional(),
  cost_category: z.string().optional(),
  gas_used: z.string().optional(),
}).catchall(z.any())

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
 */
export const ActionSchema = z.union([
  z.literal("CreateAccount"),
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
 * Final execution outcome schema - the response from send_tx
 */
export const FinalExecutionOutcomeSchema = z.object({
  final_execution_status: TxExecutionStatusSchema,
  status: ExecutionStatusSchema,
  transaction: TransactionSchema,
  transaction_outcome: ExecutionOutcomeWithIdSchema,
  receipts_outcome: z.array(ExecutionOutcomeWithIdSchema),
})

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
 */
export const FinalExecutionOutcomeWithReceiptsSchema = FinalExecutionOutcomeSchema.extend({
  receipts: z.array(ReceiptSchema),
})

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
export type ExecutionOutcomeWithId = z.infer<typeof ExecutionOutcomeWithIdSchema>
export type RpcAction = z.infer<typeof ActionSchema>
export type RpcTransaction = z.infer<typeof TransactionSchema>
export type FinalExecutionOutcome = z.infer<typeof FinalExecutionOutcomeSchema>
export type Receipt = z.infer<typeof ReceiptSchema>
export type FinalExecutionOutcomeWithReceipts = z.infer<
  typeof FinalExecutionOutcomeWithReceiptsSchema
>
