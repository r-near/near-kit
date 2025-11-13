/**
 * Constants for NEAR Protocol
 */

// ==================== Network Endpoints ====================

export const NETWORK_PRESETS = {
  mainnet: {
    rpcUrl: "https://rpc.mainnet.near.org",
    networkId: "mainnet",
    walletUrl: "https://wallet.near.org",
    helperUrl: "https://helper.mainnet.near.org",
  },
  testnet: {
    rpcUrl: "https://rpc.testnet.near.org",
    networkId: "testnet",
    walletUrl: "https://wallet.testnet.near.org",
    helperUrl: "https://helper.testnet.near.org",
  },
  localnet: {
    rpcUrl: "http://localhost:3030",
    networkId: "localnet",
    walletUrl: "http://localhost:1234",
    helperUrl: "http://localhost:3000",
  },
} as const

// ==================== Units ====================

export const YOCTO_PER_NEAR = BigInt("1000000000000000000000000")
export const GAS_PER_TGAS = BigInt("1000000000000")

// ==================== Gas Defaults ====================

export const DEFAULT_FUNCTION_CALL_GAS = "30000000000000" // 30 TGas
export const DEFAULT_GAS_BUFFER = 1.2 // 20% buffer for auto gas estimation

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
