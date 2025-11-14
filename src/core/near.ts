/**
 * Main NEAR client class
 */

import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import { NearError } from "../errors/index.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { parseKey } from "../utils/key.js"
import {
  type NearConfig,
  NearConfigSchema,
  resolveNetworkConfig,
} from "./config-schemas.js"
import { RpcClient } from "./rpc/rpc.js"
import { TransactionBuilder } from "./transaction.js"
import type { CallOptions, KeyStore, Signer } from "./types.js"

export class Near {
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer
  private _networkId: string
  private defaultSignerId?: string

  constructor(config: NearConfig = {}) {
    // Validate configuration
    const validatedConfig = NearConfigSchema.parse(config)

    // Determine network configuration
    const networkConfig = resolveNetworkConfig(validatedConfig.network)

    // Initialize RPC client
    const rpcUrl = validatedConfig.rpcUrl || networkConfig.rpcUrl
    this.rpc = new RpcClient(rpcUrl, validatedConfig.headers)
    this._networkId = networkConfig.networkId

    // Initialize key store
    this.keyStore = this.resolveKeyStore(validatedConfig.keyStore)

    // Set up signer and add key to keyStore if privateKey provided
    const signer = validatedConfig["signer"]
    const privateKey = validatedConfig.privateKey
    if (signer) {
      this.signer = signer
    } else if (privateKey) {
      const keyPair =
        typeof privateKey === "string"
          ? parseKey(privateKey)
          : parseKey(privateKey.toString())

      this.signer = async (message: Uint8Array) => keyPair.sign(message)

      // If network is a Sandbox-like object with rootAccount, add key to keyStore
      // Use original config.network (before validation) to preserve extra properties
      const network = config.network as unknown
      if (network && typeof network === "object" && "rootAccount" in network) {
        const rootAccount = (network as { rootAccount: { id: string } })
          .rootAccount
        void this.keyStore.add(rootAccount.id, keyPair)
      }
    }
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
      throw new NearError(
        "No signer ID provided. Set signerId in options or config.",
        "MISSING_SIGNER",
      )
    }

    const functionCallOptions: {
      gas?: string | number
      attachedDeposit?: string | number
    } = {}
    if (options.gas !== undefined) {
      functionCallOptions.gas = options.gas
    }
    if (options.attachedDeposit !== undefined) {
      functionCallOptions.attachedDeposit = options.attachedDeposit
    }

    const result = await this.transaction(signerId)
      .functionCall(contractId, methodName, args, functionCallOptions)
      .send()

    return result as T
  }

  /**
   * Send NEAR tokens to an account
   */
  async send(receiverId: string, amount: string | number): Promise<unknown> {
    if (!this.defaultSignerId) {
      throw new NearError(
        "No signer ID configured. Cannot send tokens.",
        "MISSING_SIGNER",
      )
    }

    return await this.transaction(this.defaultSignerId)
      .transfer(receiverId, amount)
      .send()
  }

  /**
   * Get account balance in NEAR
   */
  async getBalance(accountId: string): Promise<string> {
    // RPC client now throws AccountDoesNotExistError directly
    const account = await this.rpc.getAccount(accountId)

    // Convert yoctoNEAR to NEAR
    const balanceYocto = BigInt(account.amount)
    const balanceNear = Number(balanceYocto) / 1e24

    return balanceNear.toFixed(2)
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
