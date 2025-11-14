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
 */
export const RpcErrorResponseSchema = z.object({
  name: z.string(),
  code: z.number(),
  message: z.string(),
  data: z.string().optional(),
  cause: z
    .object({
      name: z.string(),
      info: z
        .object({
          requested_account_id: z.string().optional(),
          contract_id: z.string().optional(),
          method_name: z.string().optional(),
        })
        .catchall(z.any())
        .optional(),
    })
    .optional(),
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
