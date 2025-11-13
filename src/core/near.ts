/**
 * Main NEAR client class
 */

import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import { AccountDoesNotExistError, NetworkError } from "../errors/index.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { parseKey } from "../utils/key.js"
import { NETWORK_PRESETS } from "./constants.js"
import { RpcClient } from "./rpc.js"
import { TransactionBuilder } from "./transaction.js"
import type {
  CallOptions,
  KeyStore,
  NearConfig,
  NetworkConfig,
  Signer,
} from "./types.js"

export class Near {
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer
  private networkId: string
  private defaultSignerId?: string
  private autoGas: boolean

  constructor(config: NearConfig = {}) {
    // Determine network configuration
    const networkConfig = this.resolveNetworkConfig(config.network)

    // Initialize RPC client
    const rpcUrl = config.rpcUrl || networkConfig.rpcUrl
    this.rpc = new RpcClient(rpcUrl, config.headers)
    this.networkId = networkConfig.networkId

    // Initialize key store
    this.keyStore = this.resolveKeyStore(config.keyStore)

    // Set up signer
    if (config.signer) {
      this.signer = config.signer
    } else if (config.privateKey) {
      const keyPair =
        typeof config.privateKey === "string"
          ? parseKey(config.privateKey)
          : parseKey(config.privateKey.toString())

      this.signer = async (message: Uint8Array) => keyPair.sign(message)
    }

    this.autoGas = config.autoGas ?? true
  }

  /**
   * Resolve network configuration from config input
   */
  private resolveNetworkConfig(network?: NetworkConfig): {
    rpcUrl: string
    networkId: string
    walletUrl?: string
    helperUrl?: string
  } {
    // Default to mainnet
    if (!network) {
      const envNetwork = process.env["NEAR_NETWORK"]
      if (envNetwork && envNetwork in NETWORK_PRESETS) {
        return NETWORK_PRESETS[envNetwork as keyof typeof NETWORK_PRESETS]
      }
      return NETWORK_PRESETS.mainnet
    }

    // Network preset
    if (typeof network === "string") {
      return NETWORK_PRESETS[network]
    }

    // Custom network config
    return network
  }

  /**
   * Resolve key store from config input
   */
  private resolveKeyStore(
    keyStoreConfig?: KeyStore | string | Record<string, string>,
  ): KeyStore {
    if (!keyStoreConfig) {
      return new InMemoryKeyStore()
    }

    if (typeof keyStoreConfig === "string") {
      // Import FileKeyStore dynamically to avoid bundling in browser
      // For now, return in-memory
      return new InMemoryKeyStore()
    }

    if ("add" in keyStoreConfig && "get" in keyStoreConfig) {
      return keyStoreConfig as KeyStore
    }

    // Record of account -> key mappings
    return new InMemoryKeyStore(keyStoreConfig as Record<string, string>)
  }

  /**
   * Call a view function on a contract (read-only, no gas)
   */
  async view<T = unknown>(
    contractId: string,
    methodName: string,
    args: object = {},
  ): Promise<T> {
    const result = await this.rpc.viewFunction(contractId, methodName, args)

    // Decode result
    const resultBuffer = new Uint8Array(result.result)
    const resultString = new TextDecoder().decode(resultBuffer)

    if (!resultString) {
      return undefined as T
    }

    try {
      return JSON.parse(resultString) as T
    } catch {
      return resultString as T
    }
  }

  /**
   * Call a change function on a contract (requires signature and gas)
   */
  async call<T = unknown>(
    contractId: string,
    methodName: string,
    args: object = {},
    options: CallOptions = {},
  ): Promise<T> {
    const signerId = options.signerId || this.defaultSignerId
    if (!signerId) {
      throw new Error(
        "No signer ID provided. Set signerId in options or config.",
      )
    }

    const result = await this.transaction(signerId)
      .functionCall(contractId, methodName, args, options)
      .send()

    return result as T
  }

  /**
   * Send NEAR tokens to an account
   */
  async send(receiverId: string, amount: string | number): Promise<unknown> {
    if (!this.defaultSignerId) {
      throw new Error("No signer ID configured. Cannot send tokens.")
    }

    return await this.transaction(this.defaultSignerId)
      .transfer(receiverId, amount)
      .send()
  }

  /**
   * Get account balance in NEAR
   */
  async getBalance(accountId: string): Promise<string> {
    try {
      const account = await this.rpc.getAccount(accountId)

      // Convert yoctoNEAR to NEAR
      const balanceYocto = BigInt(account.amount)
      const balanceNear = Number(balanceYocto) / 1e24

      return balanceNear.toFixed(2)
    } catch (error) {
      if (error instanceof NetworkError && error.data) {
        throw new AccountDoesNotExistError(accountId)
      }
      throw error
    }
  }

  /**
   * Check if an account exists
   */
  async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.rpc.getAccount(accountId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get network status
   */
  async getStatus(): Promise<{
    chainId: string
    latestBlockHeight: number
    syncing: boolean
  }> {
    const status = await this.rpc.getStatus()

    return {
      chainId: status.chain_id,
      latestBlockHeight: status.sync_info.latest_block_height,
      syncing: status.sync_info.syncing,
    }
  }

  /**
   * Batch multiple read operations
   */
  async batch<T extends unknown[]>(
    ...promises: Array<Promise<T[number]>>
  ): Promise<T> {
    return Promise.all(promises) as Promise<T>
  }

  /**
   * Create a transaction builder
   */
  transaction(signerId: string): TransactionBuilder {
    return new TransactionBuilder(
      signerId,
      this.rpc,
      this.keyStore,
      this.signer,
    )
  }

  /**
   * Create a type-safe contract interface
   */
  contract<T extends ContractMethods>(contractId: string): T {
    return createContract<T>(this, contractId)
  }
}
