/**
 * Main NEAR client class
 */

import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import { NearError } from "../errors/index.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { parseKey } from "../utils/key.js"
import { generateNonce } from "../utils/nep413.js"
import type { Amount, Gas } from "../utils/validation.js"
import { normalizeAmount, normalizeGas } from "../utils/validation.js"
import * as actions from "./actions.js"
import {
  type BlockReference,
  type NearConfig,
  NearConfigSchema,
  resolveNetworkConfig,
} from "./config-schemas.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "./constants.js"
import { RpcClient } from "./rpc/rpc.js"
import type {
  FinalExecutionOutcome,
  FinalExecutionOutcomeWithReceiptsMap,
} from "./rpc/rpc-schemas.js"
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

/**
 * Main client for interacting with the NEAR blockchain.
 *
 * Wraps RPC access, key management, wallet integrations, and the fluent
 * transaction builder. Most applications create one `Near` instance per
 * network and reuse it for all operations.
 *
 * @remarks
 * Configure the client with {@link NearConfig} to choose networks, key stores,
 * wallets, and retry behavior. For a guided overview see
 * `docs/01-getting-started.md` and `docs/02-core-concepts.md`.
 */
export class Near {
  private rpc!: RpcClient
  private keyStore!: KeyStore
  private signer?: Signer
  private wallet?: WalletConnection
  private defaultSignerId?: string
  private defaultWaitUntil: TxExecutionStatus
  private pendingKeyStoreInit?: Promise<void>

  constructor(config: NearConfig = {}) {
    const validatedConfig = NearConfigSchema.parse(config)

    this._initializeRpc(validatedConfig)
    this._resolveKeyStore(validatedConfig)
    this._resolveSigner(validatedConfig, config)

    if (validatedConfig.defaultSignerId) {
      this.defaultSignerId = validatedConfig.defaultSignerId
    }
    this.defaultWaitUntil =
      validatedConfig.defaultWaitUntil || "EXECUTED_OPTIMISTIC"
    this.wallet = validatedConfig.wallet
  }

  /**
   * Initialize RPC client from configuration
   * @internal
   */
  private _initializeRpc(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
  ): void {
    const networkConfig = resolveNetworkConfig(validatedConfig.network)
    const rpcUrl = validatedConfig.rpcUrl || networkConfig.rpcUrl
    this.rpc = new RpcClient(
      rpcUrl,
      validatedConfig.headers,
      validatedConfig.retryConfig,
    )
  }

  /**
   * Resolve and initialize keystore from configuration
   * @internal
   */
  private _resolveKeyStore(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
  ): void {
    this.keyStore = this.resolveKeyStore(validatedConfig.keyStore)
  }

  /**
   * Resolve and initialize signer from configuration
   * Handles privateKey, custom signer, and sandbox root key auto-detection
   * @internal
   */
  private _resolveSigner(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
    originalConfig: NearConfig,
  ): void {
    const signer = validatedConfig.signer
    const privateKey = validatedConfig.privateKey

    if (signer) {
      // Custom signer function (e.g., hardware wallet)
      this.signer = signer
    } else if (privateKey) {
      // When privateKey is provided, add it to keyStore instead of creating a signer wrapper
      // This ensures consistent behavior - all key-based operations go through keyStore
      const keyPair =
        typeof privateKey === "string"
          ? parseKey(privateKey)
          : parseKey(privateKey.toString())

      // Determine which account ID to use for storing the key
      let accountId: string | undefined

      // If network is a Sandbox-like object with rootAccount, use that
      const network = originalConfig.network as unknown
      if (network && typeof network === "object" && "rootAccount" in network) {
        const rootAccount = (network as { rootAccount: { id: string } })
          .rootAccount
        accountId = rootAccount.id
      }

      // If defaultSignerId is provided, use that (takes precedence)
      if (validatedConfig.defaultSignerId) {
        accountId = validatedConfig.defaultSignerId
      }

      // Add the key to keyStore if we have an account ID
      // Store the promise to ensure async keystores complete initialization
      if (accountId) {
        this.pendingKeyStoreInit = this.keyStore.add(accountId, keyPair)
      }
    }

    // Auto-add sandbox root key to keyStore if available and no explicit signer/privateKey
    // This enables simple usage like: new Near({ network: sandbox })
    // while still allowing multi-account scenarios via keyStore
    if (!signer && !privateKey) {
      const network = originalConfig.network as unknown
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
      delete this.pendingKeyStoreInit
    }
  }

  /**
   * Resolve key store from config input
   * @internal
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
   * @internal
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
   * Call a view function on a contract (read-only, no gas).
   *
   * @param contractId - Target contract account ID.
   * @param methodName - Name of the view method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional {@link BlockReference} to specify finality or block.
   *
   * @returns Parsed JSON result when the contract returns JSON, otherwise the
   * raw string value typed as `T`.
   *
   * @remarks
   * - View calls are free and do not require a signer or gas.
   * - Errors thrown by the contract surface as {@link ContractExecutionError}.
   *
   * @see NearConfig.defaultWaitUntil
   */
  async view<T = unknown>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options?: BlockReference,
  ): Promise<T> {
    const result = await this.rpc.viewFunction(
      contractId,
      methodName,
      args,
      options,
    )

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
   * Call a change function on a contract (requires signature and gas).
   *
   * Uses the connected wallet when available, otherwise falls back to the
   * configured signer / private key / key store.
   *
   * @param contractId - Target contract account ID.
   * @param methodName - Name of the change method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Call options such as gas, attached deposit, signerId and wait level.
   *
   * @returns The decoded contract return value typed as `T`.
   *
   * @throws {NearError} If no signer can be resolved.
   * @throws {FunctionCallError} If the contract panics or returns an error.
   * @throws {InvalidTransactionError} If the transaction itself is invalid.
   * @throws {NetworkError} If the RPC request fails after retries.
   *
   * @example
   * ```typescript
   * await near.call(
   *   "contract.near",
   *   "increment",
   *   { by: 1 },
   *   { attachedDeposit: "1 yocto", gas: "30 Tgas" },
   * )
   * ```
   */
  async call<T = FinalExecutionOutcome>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options: CallOptions = {},
  ): Promise<T> {
    const signerId = await this.getSignerId(options.signerId)

    // Use wallet if available
    if (this.wallet) {
      const argsBytes =
        args instanceof Uint8Array
          ? args
          : new TextEncoder().encode(JSON.stringify(args))

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
      gas?: Gas
      attachedDeposit?: Amount
    } = {}
    if (options.gas !== undefined) {
      functionCallOptions.gas = options.gas
    }
    if (options.attachedDeposit !== undefined) {
      functionCallOptions.attachedDeposit = options.attachedDeposit
    }

    const sendOptions = options.waitUntil
      ? { waitUntil: options.waitUntil }
      : {}

    const result = await this.transaction(signerId)
      .functionCall(contractId, methodName, args, functionCallOptions)
      .send(sendOptions)

    return result as T
  }

  /**
   * Send NEAR tokens to an account.
   *
   * @param receiverId - Account ID that will receive the tokens.
   * @param amount - Amount to send, expressed as {@link Amount} (e.g. `"10 NEAR"` or `"1 yocto"`).
   *
   * @returns The final transaction outcome from the wallet or RPC.
   *
   * @throws {NearError} If no signer can be resolved.
   * @throws {InvalidTransactionError} If the transfer transaction is invalid.
   * @throws {NetworkError} If the RPC request fails after retries.
   *
   * @remarks
   * This is a convenience wrapper over {@link Near.transaction} with a single
   * `transfer` action.
   */
  async send(
    receiverId: string,
    amount: Amount,
  ): Promise<FinalExecutionOutcome> {
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
   * Sign a message using NEP-413 standard.
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
      nonce: "nonce" in params ? params.nonce : generateNonce(),
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
   * Get account balance in NEAR.
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Balance formatted as `"X.YY NEAR"`.
   *
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * This is a convenience helper over {@link RpcClient.getAccount}. For more
   * detailed information (storage, locked balance, etc.) call `rpc.getAccount`
   * directly.
   */
  async getBalance(
    accountId: string,
    options?: BlockReference,
  ): Promise<string> {
    // RPC client now throws AccountDoesNotExistError directly
    const account = await this.rpc.getAccount(accountId, options)

    // Convert yoctoNEAR to NEAR
    const balanceYocto = BigInt(account.amount)
    const balanceNear = Number(balanceYocto) / 1e24

    return balanceNear.toFixed(2)
  }

  /**
   * Check if an account exists.
   *
   * @param accountId - Account ID to check.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns `true` if the account exists, `false` otherwise.
   *
   * @remarks
   * This method swallows all errors and returns `false` on failure. Use
   * {@link RpcClient.getAccount} if you need to distinguish error causes.
   */
  async accountExists(
    accountId: string,
    options?: BlockReference,
  ): Promise<boolean> {
    try {
      await this.rpc.getAccount(accountId, options)
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
   * const status = await near.getTransactionStatus(
   *   '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1',
   *   'alice.near'
   * )
   *
   * // Wait for full finality
   * const finalStatus = await near.getTransactionStatus(
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
  async getTransactionStatus<
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
    W extends keyof FinalExecutionOutcomeWithReceiptsMap
      ? FinalExecutionOutcomeWithReceiptsMap[W]
      : never
  > {
    return this.rpc.getTransactionStatus(
      txHash,
      senderAccountId,
      waitUntil,
    ) as Promise<
      W extends keyof FinalExecutionOutcomeWithReceiptsMap
        ? FinalExecutionOutcomeWithReceiptsMap[W]
        : never
    >
  }

  /**
   * Get basic network status information.
   *
   * @returns An object containing `chainId`, `latestBlockHeight`, and `syncing` flag.
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
   * Batch multiple read operations.
   *
   * @param promises - Promises to execute in parallel.
   *
   * @returns A tuple of resolved values preserving the input order.
   *
   * @remarks
   * This is a thin wrapper over `Promise.all` with a tuple-friendly signature.
   * It does not perform any RPC-level batching.
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
      this.pendingKeyStoreInit ? () => this.ensureKeyStoreReady() : undefined,
    )
  }

  /**
   * Create a type-safe contract interface.
   *
   * @param contractId - Account ID of the target contract.
   *
   * @returns A proxy implementing your {@link ContractMethods} interface.
   *
   * @example
   * ```typescript
   * type Counter = Contract<{
   *   view: { get_count: () => Promise<number> }
   *   call: { increment: () => Promise<void> }
   * }>
   *
   * const counter = near.contract<Counter>("counter.near")
   * ```
   */
  contract<T extends ContractMethods>(contractId: string): T {
    return createContract<T>(this, contractId)
  }
}
