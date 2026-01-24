/**
 * Constants for NEAR Protocol
 */

// ==================== Network Endpoints ====================

export const NETWORK_PRESETS = {
  mainnet: {
    rpcUrl: "https://free.rpc.fastnear.com",
    networkId: "mainnet",
  },
  testnet: {
    rpcUrl: "https://rpc.testnet.fastnear.com",
    networkId: "testnet",
  },
  localnet: {
    rpcUrl: "http://localhost:3030",
    networkId: "localnet",
  },
  betanet: {
    rpcUrl: "https://rpc.betanet.near.org",
    networkId: "betanet",
  },
} as const

// ==================== Units ====================

export const YOCTO_PER_NEAR = BigInt("1000000000000000000000000")
export const GAS_PER_TGAS = BigInt("1000000000000")

// ==================== Gas Defaults ====================

export const DEFAULT_FUNCTION_CALL_GAS = "30000000000000" // 30 TGas

// ==================== Storage ====================

/**
 * Cost per byte of storage in yoctoNEAR.
 *
 * This is a protocol constant (10^19 yoctoNEAR per byte = 0.00001 NEAR/byte).
 * It has remained unchanged since NEAR genesis and would require a hard fork
 * to modify. Used for calculating available balance.
 *
 * @see https://docs.near.org/concepts/storage/storage-staking
 */
export const STORAGE_AMOUNT_PER_BYTE = BigInt("10000000000000000000") // 10^19 yoctoNEAR

// ==================== Account ID Validation ====================

export const ACCOUNT_ID_REGEX =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/
export const MIN_ACCOUNT_ID_LENGTH = 2
export const MAX_ACCOUNT_ID_LENGTH = 64

// ==================== Key Formats ====================

export const ED25519_KEY_PREFIX = "ed25519:"
export const SECP256K1_KEY_PREFIX = "secp256k1:"

// ==================== RPC Methods ====================

export const RPC_METHODS = {
  QUERY: "query",
  BROADCAST_TX_COMMIT: "broadcast_tx_commit",
  BROADCAST_TX_ASYNC: "broadcast_tx_async",
  TX_STATUS: "tx",
  BLOCK: "block",
  CHUNK: "chunk",
  VALIDATORS: "validators",
  GAS_PRICE: "gas_price",
  STATUS: "status",
} as const
