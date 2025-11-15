/**
 * Main NEAR client class
 */

import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import { NearError } from "../errors/index.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { parseKey } from "../utils/key.js"
import { generateNep413Nonce } from "../utils/nep413.js"
import type { Amount } from "../utils/validation.js"
import { normalizeAmount, normalizeGas } from "../utils/validation.js"
import * as actions from "./actions.js"
import {
  type NearConfig,
  NearConfigSchema,
  resolveNetworkConfig,
} from "./config-schemas.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "./constants.js"
import { RpcClient } from "./rpc/rpc.js"
import { TransactionBuilder } from "./transaction.js"
import type {
  CallOptions,
  KeyStore,
  SignedMessage,
  Signer,
  SignMessageParams,
  TxExecutionStatus,
  WalletConnection,
} from "./types.js"

export class Near {
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer
  private wallet?: WalletConnection
  private defaultSignerId?: string
  private defaultWaitUntil: TxExecutionStatus
  private pendingKeyStoreInit?: Promise<void>

  constructor(config: NearConfig = {}) {
    // Validate configuration
    const validatedConfig = NearConfigSchema.parse(config)

    // Determine network configuration
    const networkConfig = resolveNetworkConfig(validatedConfig.network)

    // Initialize RPC client
    const rpcUrl = validatedConfig.rpcUrl || networkConfig.rpcUrl
    this.rpc = new RpcClient(
      rpcUrl,
      validatedConfig.headers,
      validatedConfig.retryConfig,
    )

    // Initialize key store
    this.keyStore = this.resolveKeyStore(validatedConfig.keyStore)

    // Initialize default wait until
    this.defaultWaitUntil =
      validatedConfig.defaultWaitUntil || "EXECUTED_OPTIMISTIC"

    // Store wallet if provided
    this.wallet = validatedConfig.wallet

    // Set up signer
    const signer = validatedConfig.signer
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

    // Auto-add sandbox root key to keyStore if available and no explicit signer/privateKey
    // This enables simple usage like: new Near({ network: sandbox })
    // while still allowing multi-account scenarios via keyStore
    if (!signer && !privateKey) {
      const network = config.network as unknown
      if (network && typeof network === "object" && "rootAccount" in network) {
        const rootAccount = network as {
          rootAccount: { id?: string; secretKey?: string }
        }
        // Guard: only auto-add if both id and secretKey are non-empty strings
        if (
          rootAccount.rootAccount?.id &&
          rootAccount.rootAccount?.secretKey &&
          typeof rootAccount.rootAccount.secretKey === "string"
        ) {
          const keyPair = parseKey(rootAccount.rootAccount.secretKey)
          // Store the promise to ensure async keystores complete initialization
          this.pendingKeyStoreInit = this.keyStore.add(
            rootAccount.rootAccount.id,
            keyPair,
          )
        }
      }
    }
  }

  /**
   * Ensure any pending keystore initialization is complete
   * @internal
   */
  private async ensureKeyStoreReady(): Promise<void> {
    if (this.pendingKeyStoreInit) {
      await this.pendingKeyStoreInit
      this.pendingKeyStoreInit = undefined
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
   * Get signer ID from options, default, or wallet
   */
  private async getSignerId(signerId?: string): Promise<string> {
    if (signerId) return signerId
    if (this.defaultSignerId) return this.defaultSignerId

    // Get from wallet if available
    if (this.wallet) {
      const accounts = await this.wallet.getAccounts()
      if (accounts.length === 0) {
        throw new NearError(
          "No accounts connected to wallet",
          "NO_WALLET_ACCOUNTS",
        )
      }
      // Safe to use non-null assertion after length check
      // biome-ignore lint/style/noNonNullAssertion: verified accounts[0] exists above
      return accounts[0]!.accountId
    }

    throw new NearError(
      "No signer ID provided. Set signerId in options or config.",
      "MISSING_SIGNER",
    )
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
    const signerId = await this.getSignerId(options.signerId)

    // Use wallet if available
    if (this.wallet) {
      const argsJson = JSON.stringify(args)
      const argsBytes = new TextEncoder().encode(argsJson)

      const gas = options.gas
        ? normalizeGas(options.gas)
        : DEFAULT_FUNCTION_CALL_GAS

      const deposit = options.attachedDeposit
        ? normalizeAmount(options.attachedDeposit)
        : "0"

      const result = await this.wallet.signAndSendTransaction({
        signerId,
        receiverId: contractId,
        actions: [
          actions.functionCall(
            methodName,
            argsBytes,
            BigInt(gas),
            BigInt(deposit),
          ),
        ],
      })

      return result as T
    }

    // Use private key/signer approach
    const functionCallOptions: {
      gas?: string
      attachedDeposit?: string | bigint
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
  async send(receiverId: string, amount: Amount): Promise<unknown> {
    const signerId = await this.getSignerId()

    // Use wallet if available
    if (this.wallet) {
      const amountYocto = normalizeAmount(amount)

      return await this.wallet.signAndSendTransaction({
        signerId,
        receiverId,
        actions: [actions.transfer(BigInt(amountYocto))],
      })
    }

    // Use private key/signer approach
    return await this.transaction(signerId).transfer(receiverId, amount).send()
  }

  /**
   * Sign a message using NEP-413 standard
   *
   * NEP-413 enables off-chain message signing for authentication and ownership verification
   * without gas fees or blockchain transactions. Useful for:
   * - Login/authentication flows
   * - Proving account ownership
   * - Signing intents for meta-transactions
   * - Off-chain authorization
   *
   * @param params - Message signing parameters
   * @param options - Optional signer ID (defaults to first account)
   * @returns Signed message with account ID, public key, and signature
   *
   * @throws {NearError} If no wallet or keystore is configured
   * @throws {NearError} If the key doesn't support NEP-413 signing
   *
   * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
   *
   * @example
   * ```typescript
   * // Sign a message for authentication
   * const signedMessage = await near.signMessage({
   *   message: "Login to MyApp",
   *   recipient: "myapp.near",
   *   nonce: crypto.getRandomValues(new Uint8Array(32)),
   * })
   *
   * // Send to backend for verification
   * await fetch("/api/auth", {
   *   method: "POST",
   *   body: JSON.stringify(signedMessage),
   * })
   * ```
   */
  async signMessage(
    params: SignMessageParams | Omit<SignMessageParams, "nonce">,
    options?: { signerId?: string },
  ): Promise<SignedMessage> {
    const signerId = await this.getSignerId(options?.signerId)

    // Add nonce if not provided
    const fullParams: SignMessageParams = {
      ...params,
      nonce: "nonce" in params ? params.nonce : generateNep413Nonce(),
    }

    // Try wallet first if available
    if (this.wallet?.signMessage) {
      try {
        return await this.wallet.signMessage(fullParams)
      } catch (error) {
        // Fall through to keystore if wallet doesn't support it
        console.warn("Wallet signMessage failed, trying keystore:", error)
      }
    }

    // Use keystore approach
    // Ensure any pending keystore initialization is complete
    await this.ensureKeyStoreReady()

    const keyPair = await this.keyStore.get(signerId)
    if (!keyPair) {
      throw new NearError(
        `No key found for account ${signerId}. Add a key using keyStore.add() or configure a wallet.`,
        "NO_KEY_FOUND",
      )
    }

    if (!keyPair.signNep413Message) {
      throw new NearError(
        "Key pair does not support NEP-413 message signing",
        "UNSUPPORTED_OPERATION",
      )
    }

    return keyPair.signNep413Message(signerId, fullParams)
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
   * Get transaction status with detailed receipt information
   *
   * Queries the status of a transaction by hash using the EXPERIMENTAL_tx_status RPC method,
   * returning the final transaction result with detailed receipt information.
   *
   * @param txHash - Transaction hash to query
   * @param senderAccountId - Account ID that sent the transaction (used to determine shard)
   * @param waitUntil - Optional execution level to wait for (default: "EXECUTED_OPTIMISTIC")
   *
   * @returns Transaction status with receipts, typed based on waitUntil parameter
   *
   * @throws {InvalidTransactionError} If transaction execution failed
   * @throws {NetworkError} If network request failed
   *
   * @example
   * ```typescript
   * // Get transaction status with default wait level
   * const status = await near.txStatus(
   *   '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1',
   *   'alice.near'
   * )
   *
   * // Wait for full finality
   * const finalStatus = await near.txStatus(
   *   '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1',
   *   'alice.near',
   *   'FINAL'
   * )
   *
   * // Access receipt details
   * console.log('Receipts:', finalStatus.receipts)
   * ```
   *
   * @see {@link https://docs.near.org/api/rpc/transactions#transaction-status-with-receipts NEAR RPC Documentation}
   */
  async txStatus<
    W extends
      | "NONE"
      | "INCLUDED"
      | "EXECUTED_OPTIMISTIC"
      | "INCLUDED_FINAL"
      | "EXECUTED"
      | "FINAL" = "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Promise<
    W extends keyof import("./rpc/rpc-schemas.js").FinalExecutionOutcomeWithReceiptsMap
      ? import("./rpc/rpc-schemas.js").FinalExecutionOutcomeWithReceiptsMap[W]
      : never
  > {
    return this.rpc.getTransactionStatus(txHash, senderAccountId, waitUntil)
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
   * Create a transaction builder for the specified signer account.
   *
   * The `signerId` determines which account will sign and send this transaction.
   * This account must have keys available in the configured keyStore, privateKey,
   * custom signer, or be connected via wallet.
   *
   * @param signerId - The account ID that will sign and pay for this transaction
   *
   * @returns A transaction builder for chaining actions
   *
   * @example
   * ```typescript
   * // Alice sends NEAR to Bob
   * await near.transaction('alice.near')
   *   .transfer('bob.near', '10 NEAR')
   *   .send()
   *
   * // Alice calls a contract and creates a new account
   * await near.transaction('alice.near')
   *   .functionCall('market.near', 'buy', { id: 123 })
   *   .createAccount('sub.alice.near')
   *   .transfer('sub.alice.near', '5 NEAR')
   *   .send()
   * ```
   *
   * @see {@link TransactionBuilder} for available actions
   */
  transaction(signerId: string): TransactionBuilder {
    return new TransactionBuilder(
      signerId,
      this.rpc,
      this.keyStore,
      this.signer,
      this.defaultWaitUntil,
      this.wallet,
      this.pendingKeyStoreInit
        ? () => this.ensureKeyStoreReady()
        : undefined,
    )
  }

  /**
   * Create a type-safe contract interface
   */
  contract<T extends ContractMethods>(contractId: string): T {
    return createContract<T>(this, contractId)
  }
}
