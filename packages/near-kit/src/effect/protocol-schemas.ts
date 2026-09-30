/** Effect-native codecs for the public NEAR JSON-RPC wire contracts.
 * Keep the legacy Zod exports in core/rpc/rpc-schemas.ts source-compatible.
 * Finite numbers, optional undefined values, mutable arrays, stripping structs
 * and explicit catch-all records intentionally match those public contracts.
 */
import { Schema } from "effect"

export const FunctionCallPermissionDetailsSchema = Schema.Struct({
  receiver_id: Schema.String,
  method_names: Schema.mutable(Schema.Array(Schema.String)),
  allowance: Schema.optional(Schema.NullOr(Schema.String)),
})

export const GasKeyFunctionCallPermissionDetailsSchema = Schema.Struct({
  balance: Schema.String,
  num_nonces: Schema.Finite,
  receiver_id: Schema.String,
  method_names: Schema.mutable(Schema.Array(Schema.String)),
  allowance: Schema.optional(Schema.NullOr(Schema.String)),
})

export const GasKeyFullAccessPermissionDetailsSchema = Schema.Struct({
  balance: Schema.String,
  num_nonces: Schema.Finite,
})

export const AccessKeyPermissionSchema = Schema.Union(
  [
    Schema.Literal("FullAccess"),
    Schema.Struct({
      FunctionCall: FunctionCallPermissionDetailsSchema,
    }),
    Schema.Struct({
      GasKeyFunctionCall: GasKeyFunctionCallPermissionDetailsSchema,
    }),
    Schema.Struct({
      GasKeyFullAccess: GasKeyFullAccessPermissionDetailsSchema,
    }),
  ],
  { mode: "anyOf" },
)

export const ViewFunctionCallResultSchema = Schema.Struct({
  result: Schema.mutable(Schema.Array(Schema.Finite)),
  logs: Schema.mutable(Schema.Array(Schema.String)),
  block_height: Schema.Finite,
  block_hash: Schema.String,
})

export const AccountViewSchema = Schema.Struct({
  amount: Schema.String,
  locked: Schema.String,
  code_hash: Schema.String,
  global_contract_hash: Schema.optional(Schema.NullOr(Schema.String)),
  global_contract_account_id: Schema.optional(Schema.NullOr(Schema.String)),
  storage_usage: Schema.Finite,
  storage_paid_at: Schema.Finite,
  block_height: Schema.Finite,
  block_hash: Schema.String,
})

export const ContractCodeViewSchema = Schema.Struct({
  code_base64: Schema.String,
  hash: Schema.String,
  block_height: Schema.Finite,
  block_hash: Schema.String,
})

export const AccessKeyViewSchema = Schema.Struct({
  nonce: Schema.Finite,
  permission: AccessKeyPermissionSchema,
  block_height: Schema.Finite,
  block_hash: Schema.String,
})

export const AccessKeyInfoViewSchema = Schema.Struct({
  public_key: Schema.String,
  access_key: AccessKeyViewSchema,
})

export const BlockHeaderViewSchema = Schema.Struct({
  height: Schema.Finite,
  prev_height: Schema.optional(Schema.NullOr(Schema.Finite)),
  epoch_id: Schema.String,
  next_epoch_id: Schema.String,
  hash: Schema.String,
  prev_hash: Schema.String,
  prev_state_root: Schema.String,
  chunk_receipts_root: Schema.String,
  chunk_headers_root: Schema.String,
  chunk_tx_root: Schema.String,
  outcome_root: Schema.String,
  chunks_included: Schema.Finite,
  challenges_root: Schema.String,
  timestamp: Schema.Finite,
  timestamp_nanosec: Schema.String,
  random_value: Schema.String,
  validator_proposals: Schema.mutable(Schema.Array(Schema.Any)),
  chunk_mask: Schema.mutable(Schema.Array(Schema.Boolean)),
  gas_price: Schema.String,
  block_ordinal: Schema.optional(Schema.NullOr(Schema.Finite)),
  total_supply: Schema.String,
  challenges_result: Schema.mutable(Schema.Array(Schema.Any)),
  last_final_block: Schema.String,
  last_ds_final_block: Schema.String,
  next_bp_hash: Schema.String,
  block_merkle_root: Schema.String,
  epoch_sync_data_hash: Schema.optional(Schema.NullOr(Schema.String)),
  approvals: Schema.mutable(Schema.Array(Schema.NullOr(Schema.String))),
  signature: Schema.String,
  latest_protocol_version: Schema.Finite,
})

export const ChunkHeaderViewSchema = Schema.Struct({
  chunk_hash: Schema.String,
  prev_block_hash: Schema.String,
  outcome_root: Schema.String,
  prev_state_root: Schema.String,
  encoded_merkle_root: Schema.String,
  encoded_length: Schema.Finite,
  height_created: Schema.Finite,
  height_included: Schema.Finite,
  shard_id: Schema.Finite,
  gas_used: Schema.Finite,
  gas_limit: Schema.Finite,
  validator_reward: Schema.String,
  balance_burnt: Schema.String,
  outgoing_receipts_root: Schema.String,
  tx_root: Schema.String,
  validator_proposals: Schema.mutable(Schema.Array(Schema.Any)),
  signature: Schema.String,
})

export const BlockViewSchema = Schema.Struct({
  author: Schema.String,
  header: BlockHeaderViewSchema,
  chunks: Schema.mutable(Schema.Array(ChunkHeaderViewSchema)),
})

export const StatusResponseSchema = Schema.Struct({
  version: Schema.Struct({
    version: Schema.String,
    build: Schema.String,
    commit: Schema.optional(Schema.String),
    rustc_version: Schema.optional(Schema.String),
  }),
  chain_id: Schema.String,
  genesis_hash: Schema.String,
  protocol_version: Schema.Finite,
  latest_protocol_version: Schema.Finite,
  rpc_addr: Schema.String,
  node_public_key: Schema.String,
  node_key: Schema.NullOr(Schema.String),
  validator_account_id: Schema.NullOr(Schema.String),
  validator_public_key: Schema.NullOr(Schema.String),
  validators: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        account_id: Schema.String,
      }),
    ),
  ),
  sync_info: Schema.Struct({
    latest_block_hash: Schema.String,
    latest_block_height: Schema.Finite,
    latest_state_root: Schema.String,
    latest_block_time: Schema.String,
    syncing: Schema.Boolean,
    earliest_block_hash: Schema.optional(Schema.String),
    earliest_block_height: Schema.optional(Schema.Finite),
    earliest_block_time: Schema.optional(Schema.String),
    epoch_id: Schema.optional(Schema.String),
    epoch_start_height: Schema.optional(Schema.Finite),
  }),
  uptime_sec: Schema.optional(Schema.Finite),
})

export const GasPriceResponseSchema = Schema.Struct({
  gas_price: Schema.String,
})

export const AccessKeyListResponseSchema = Schema.Struct({
  block_hash: Schema.String,
  block_height: Schema.Finite,
  keys: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        public_key: Schema.String,
        access_key: Schema.Struct({
          nonce: Schema.Finite,
          permission: AccessKeyPermissionSchema,
        }),
      }),
    ),
  ),
})

export const GasKeyNoncesResponseSchema = Schema.Struct({
  nonces: Schema.mutable(Schema.Array(Schema.Finite)),
  block_height: Schema.Finite,
  block_hash: Schema.String,
})

export const ReceiptToTxResponseSchema = Schema.Struct({
  transaction_hash: Schema.String,
  sender_account_id: Schema.String,
})

export const RpcErrorResponseSchema = Schema.Struct({
  name: Schema.String,
  code: Schema.Finite,
  message: Schema.String,
  data: Schema.optional(Schema.Any),
  cause: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      info: Schema.optional(
        Schema.StructWithRest(
          Schema.Struct({
            requested_account_id: Schema.optional(Schema.String),
            contract_id: Schema.optional(Schema.String),
            method_name: Schema.optional(Schema.String),
            ShardCongested: Schema.optional(Schema.Boolean),
            ShardStuck: Schema.optional(Schema.Boolean),
          }),
          [Schema.Record(Schema.String, Schema.Any)],
        ),
      ),
    }),
  ),
})

export const TxExecutionStatusSchema = Schema.Literals([
  "NONE",
  "INCLUDED",
  "EXECUTED_OPTIMISTIC",
  "INCLUDED_FINAL",
  "EXECUTED",
  "FINAL",
])

export const ExecutionStatusSchema = Schema.Union(
  [
    Schema.Literal("Unknown"),
    Schema.Literal("Pending"),
    Schema.Struct({
      SuccessValue: Schema.String,
    }),
    Schema.Struct({
      SuccessReceiptId: Schema.String,
    }),
    Schema.Struct({
      Failure: Schema.StructWithRest(
        Schema.Struct({
          error_message: Schema.optional(Schema.String),
          error_type: Schema.optional(Schema.String),
        }),
        [Schema.Record(Schema.String, Schema.Any)],
      ),
    }),
  ],
  { mode: "anyOf" },
)

export const GasProfileEntrySchema = Schema.StructWithRest(
  Schema.Struct({
    cost: Schema.optional(Schema.String),
    cost_category: Schema.optional(Schema.String),
    gas_used: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

export const AccountContractSchema = Schema.Union(
  [
    Schema.Struct({
      local: Schema.String,
    }),
    Schema.Struct({
      global_hash: Schema.String,
    }),
    Schema.Struct({
      global_account_id: Schema.String,
    }),
  ],
  { mode: "anyOf" },
)

const ExecutionMetadataBaseSchema = Schema.Struct({
  gas_profile: Schema.optional(
    Schema.NullOr(Schema.mutable(Schema.Array(GasProfileEntrySchema))),
  ),
})

const KNOWN_METADATA_VERSIONS = new Set([1, 2, 3, 4])

export const ExecutionMetadataSchema = Schema.Union(
  [
    ExecutionMetadataBaseSchema.pipe(
      Schema.fieldsAssign({
        version: Schema.Literal(4),
        contracts: Schema.optional(
          Schema.NullOr(
            Schema.mutable(Schema.Array(Schema.NullOr(AccountContractSchema))),
          ),
        ),
      }),
    ),
    ExecutionMetadataBaseSchema.pipe(
      Schema.fieldsAssign({
        version: Schema.Union(
          [Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)],
          { mode: "anyOf" },
        ),
      }),
    ),
    ExecutionMetadataBaseSchema.pipe(
      Schema.fieldsAssign({
        version: Schema.Finite.check(
          Schema.makeFilter((v) => !KNOWN_METADATA_VERSIONS.has(v), {
            message: "expected a typed metadata version branch",
          }),
        ),
      }),
    ),
  ],
  { mode: "anyOf" },
)

export const ExecutionOutcomeSchema = Schema.Struct({
  logs: Schema.mutable(Schema.Array(Schema.String)),
  receipt_ids: Schema.mutable(Schema.Array(Schema.String)),
  gas_burnt: Schema.Finite,
  tokens_burnt: Schema.String,
  executor_id: Schema.String,
  status: ExecutionStatusSchema,
  metadata: Schema.optional(ExecutionMetadataSchema),
})

export const MerklePathItemSchema = Schema.Struct({
  hash: Schema.String,
  direction: Schema.Literals(["Left", "Right"]),
})

export const ExecutionOutcomeWithIdSchema = Schema.Struct({
  id: Schema.String,
  outcome: ExecutionOutcomeSchema,
  block_hash: Schema.String,
  proof: Schema.mutable(Schema.Array(MerklePathItemSchema)),
})

export const ActionSchema = Schema.Union(
  [
    Schema.Literal("CreateAccount"),
    Schema.Struct({
      CreateAccount: Schema.Struct({}),
    }),
    Schema.Struct({
      Transfer: Schema.Struct({
        deposit: Schema.String,
      }),
    }),
    Schema.Struct({
      FunctionCall: Schema.Struct({
        method_name: Schema.String,
        args: Schema.String,
        gas: Schema.Finite,
        deposit: Schema.String,
      }),
    }),
    Schema.Struct({
      DeployContract: Schema.Struct({
        code: Schema.String,
      }),
    }),
    Schema.Struct({
      DeployGlobalContract: Schema.Struct({
        code: Schema.String,
      }),
    }),
    Schema.Struct({
      DeployGlobalContractByAccountId: Schema.Struct({
        code: Schema.String,
      }),
    }),
    Schema.Struct({
      Stake: Schema.Struct({
        stake: Schema.String,
        public_key: Schema.String,
      }),
    }),
    Schema.Struct({
      AddKey: Schema.Struct({
        public_key: Schema.String,
        access_key: Schema.Struct({
          nonce: Schema.Finite,
          permission: AccessKeyPermissionSchema,
        }),
      }),
    }),
    Schema.Struct({
      DeleteKey: Schema.Struct({
        public_key: Schema.String,
      }),
    }),
    Schema.Struct({
      DeleteAccount: Schema.Struct({
        beneficiary_id: Schema.String,
      }),
    }),
    Schema.Struct({
      UseGlobalContract: Schema.Struct({
        code_hash: Schema.String,
      }),
    }),
    Schema.Struct({
      UseGlobalContractByAccountId: Schema.Struct({
        account_id: Schema.String,
      }),
    }),
    Schema.Struct({
      Delegate: Schema.Struct({
        delegate_action: Schema.Struct({
          sender_id: Schema.String,
          receiver_id: Schema.String,
          actions: Schema.mutable(Schema.Array(Schema.Any)),
          nonce: Schema.Finite,
          max_block_height: Schema.Finite,
          public_key: Schema.String,
        }),
        signature: Schema.String,
      }),
    }),
    Schema.Struct({
      DeterministicStateInit: Schema.Struct({
        deposit: Schema.String,
      }),
    }),
    Schema.Struct({
      TransferToGasKey: Schema.Struct({
        public_key: Schema.String,
        deposit: Schema.String,
      }),
    }),
    Schema.Struct({
      WithdrawFromGasKey: Schema.Struct({
        public_key: Schema.String,
        amount: Schema.String,
      }),
    }),
    Schema.Struct({
      DelegateV2: Schema.Struct({
        delegate_action: Schema.Struct({
          V2: Schema.Struct({
            sender_id: Schema.String,
            receiver_id: Schema.String,
            actions: Schema.mutable(Schema.Array(Schema.Any)),
            nonce: Schema.Union(
              [
                Schema.Struct({
                  Nonce: Schema.Struct({
                    nonce: Schema.Finite,
                  }),
                }),
                Schema.Struct({
                  GasKeyNonce: Schema.Struct({
                    nonce: Schema.Finite,
                    nonce_index: Schema.Finite,
                  }),
                }),
              ],
              { mode: "anyOf" },
            ),
            max_block_height: Schema.Finite,
            public_key: Schema.String,
          }),
        }),
        signature: Schema.String,
      }),
    }),
  ],
  { mode: "anyOf" },
)

export const NonceModeSchema = Schema.Literals(["monotonic", "strict"])

export const TransactionSchema = Schema.Struct({
  signer_id: Schema.String,
  public_key: Schema.String,
  nonce: Schema.Finite,
  receiver_id: Schema.String,
  actions: Schema.mutable(Schema.Array(ActionSchema)),
  signature: Schema.String,
  hash: Schema.String,
  priority_fee: Schema.optional(Schema.Finite),
  nonce_mode: Schema.optional(Schema.NullOr(NonceModeSchema)),
})

export const MinimalTransactionSchema = Schema.Struct({
  hash: Schema.String,
  signer_id: Schema.String,
  receiver_id: Schema.String,
  nonce: Schema.Finite,
})

export const FinalExecutionOutcomeSchema = Schema.Union(
  [
    Schema.Struct({
      final_execution_status: Schema.Literal("NONE"),
      transaction: Schema.optional(MinimalTransactionSchema),
      status: Schema.optional(ExecutionStatusSchema),
      transaction_outcome: Schema.optional(ExecutionOutcomeWithIdSchema),
      receipts_outcome: Schema.optional(
        Schema.mutable(Schema.Array(ExecutionOutcomeWithIdSchema)),
      ),
    }),
    Schema.Struct({
      final_execution_status: Schema.Literal("INCLUDED"),
      transaction: Schema.optional(MinimalTransactionSchema),
      status: Schema.optional(ExecutionStatusSchema),
      transaction_outcome: Schema.optional(ExecutionOutcomeWithIdSchema),
      receipts_outcome: Schema.optional(
        Schema.mutable(Schema.Array(ExecutionOutcomeWithIdSchema)),
      ),
    }),
    Schema.Struct({
      final_execution_status: Schema.Literal("INCLUDED_FINAL"),
      transaction: Schema.optional(MinimalTransactionSchema),
      status: Schema.optional(ExecutionStatusSchema),
      transaction_outcome: Schema.optional(ExecutionOutcomeWithIdSchema),
      receipts_outcome: Schema.optional(
        Schema.mutable(Schema.Array(ExecutionOutcomeWithIdSchema)),
      ),
    }),
    Schema.Struct({
      final_execution_status: Schema.Literal("EXECUTED_OPTIMISTIC"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: Schema.mutable(
        Schema.Array(ExecutionOutcomeWithIdSchema),
      ),
    }),
    Schema.Struct({
      final_execution_status: Schema.Literal("EXECUTED"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: Schema.mutable(
        Schema.Array(ExecutionOutcomeWithIdSchema),
      ),
    }),
    Schema.Struct({
      final_execution_status: Schema.Literal("FINAL"),
      status: ExecutionStatusSchema,
      transaction: TransactionSchema,
      transaction_outcome: ExecutionOutcomeWithIdSchema,
      receipts_outcome: Schema.mutable(
        Schema.Array(ExecutionOutcomeWithIdSchema),
      ),
    }),
  ],
  { mode: "anyOf" },
)

export const ReceiptSchema = Schema.Struct({
  predecessor_id: Schema.String,
  receiver_id: Schema.String,
  receipt_id: Schema.String,
  receipt: Schema.Union(
    [
      Schema.Struct({
        Action: Schema.Struct({
          signer_id: Schema.String,
          signer_public_key: Schema.String,
          gas_price: Schema.String,
          output_data_receivers: Schema.mutable(Schema.Array(Schema.Any)),
          input_data_ids: Schema.mutable(Schema.Array(Schema.String)),
          actions: Schema.mutable(Schema.Array(ActionSchema)),
          is_promise_yield: Schema.optional(Schema.Boolean),
        }),
      }),
      Schema.Struct({
        Data: Schema.Struct({
          data_id: Schema.String,
          data: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      }),
    ],
    { mode: "anyOf" },
  ),
  priority: Schema.optional(Schema.Finite),
})

const receiptFields = { receipts: Schema.mutable(Schema.Array(ReceiptSchema)) }

export const FinalExecutionOutcomeWithReceiptsSchema = Schema.Union([
  FinalExecutionOutcomeSchema.members[0].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
  FinalExecutionOutcomeSchema.members[1].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
  FinalExecutionOutcomeSchema.members[2].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
  FinalExecutionOutcomeSchema.members[3].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
  FinalExecutionOutcomeSchema.members[4].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
  FinalExecutionOutcomeSchema.members[5].pipe(
    Schema.fieldsAssign(receiptFields),
  ),
])

export const StateItemSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})

export const ViewStateResultSchema = Schema.Struct({
  values: Schema.mutable(Schema.Array(StateItemSchema)),
  proof: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  last_key: Schema.optional(Schema.String),
  block_height: Schema.optional(Schema.Finite),
  block_hash: Schema.optional(Schema.String),
})

export const StateChangeKindSchema = Schema.Struct({
  type: Schema.Literals([
    "account_touched",
    "access_key_touched",
    "data_touched",
    "contract_code_touched",
  ]),
  account_id: Schema.String,
})

export const BlockEffectsResponseSchema = Schema.Struct({
  block_hash: Schema.String,
  changes: Schema.mutable(Schema.Array(StateChangeKindSchema)),
})

export const MaintenanceWindowSchema = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
})

export const MaintenanceWindowsResponseSchema = Schema.mutable(
  Schema.Array(MaintenanceWindowSchema),
)

export const GenesisConfigResponseSchema = Schema.StructWithRest(
  Schema.Struct({
    protocol_version: Schema.Finite,
    chain_id: Schema.String,
    genesis_height: Schema.Finite,
    genesis_time: Schema.optional(Schema.String),
    epoch_length: Schema.optional(Schema.Finite),
    num_block_producer_seats: Schema.optional(Schema.Finite),
    total_supply: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)
