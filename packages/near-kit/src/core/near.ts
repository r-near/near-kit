import { makeNearPrograms, type NearPrograms } from "../effect/near-program.js"
/**
 * Main NEAR client class
 */

import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { keyStoreService } from "../effect/keys.js"
import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import type { NonceReservationService } from "../effect/nonce.js"
import {
  fromPromise,
  runPromise,
  type ExternalError,
  type NearFailure,
} from "../effect/runtime.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { parseKey } from "../utils/key.js"
import type { Amount } from "../utils/validation.js"
import {
  NearConfigSchema,
  resolveNetworkConfig,
  type BlockReference,
  type NearConfig,
} from "./config-schemas.js"
import {
  fetchTransport,
  makeRpcProgramsUnsafe,
  type RpcPrograms,
} from "./rpc/rpc-program.js"
import type {
  AccessKeyListResponse,
  AccessKeyView,
  FinalExecutionOutcome,
  FinalExecutionOutcomeWithReceiptsMap,
  StateItem,
  StatusResponse,
  ViewStateResult,
} from "./rpc/rpc-schemas.js"
import { rpcFromPromises, rpcToPromises, type RpcClient } from "./rpc/rpc.js"
import { TransactionBuilder } from "./transaction.js"
import type {
  AccountState,
  CallOptions,
  ContractCodeResult,
  GlobalContractReference,
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
export interface NearRuntime {
  readonly rpc?: RpcPrograms
  readonly nonceReservation?: NonceReservationService
  readonly deferInitialization?: boolean
}

export class Near {
  private nativeRpc!: RpcPrograms
  private readonly nonceReservation: NonceReservationService | undefined
  private readonly programs: NearPrograms
  private readonly publicPrograms: NearEffects
  private _rpc!: RpcClient
  private keyStore!: KeyStore
  private signer?: Signer
  private wallet?: WalletConnection
  private defaultSignerId?: string
  private defaultWaitUntil: TxExecutionStatus
  private pendingKeyStoreInit?: Effect.Effect<void, ExternalError>

  constructor(config: NearConfig = {}, runtime?: NearRuntime) {
    const validatedConfig = NearConfigSchema.parse(config)

    this.nonceReservation = runtime?.nonceReservation
    this._initializeRpc(validatedConfig, runtime?.rpc)
    this._resolveKeyStore(validatedConfig)
    this._resolveSigner(validatedConfig, config)

    if (validatedConfig.defaultSignerId) {
      this.defaultSignerId = validatedConfig.defaultSignerId
    }
    this.defaultWaitUntil =
      validatedConfig.defaultWaitUntil || "EXECUTED_OPTIMISTIC"
    this.wallet = validatedConfig.wallet
    if (this.pendingKeyStoreInit) {
      const initialization = Effect.runSync(
        Effect.cached(this.pendingKeyStoreInit),
      )
      this.pendingKeyStoreInit = runtime?.deferInitialization
        ? initialization
        : Fiber.join(Effect.runFork(initialization))
    }
    this.programs = makeNearPrograms({
      rpc: this.nativeRpc,
      keyStore: this.keyStore,
      wallet: this.wallet,
      defaultSignerId: this.defaultSignerId,
      transaction: (id) => this.transaction(id),
      ready: () => this.ensureKeyStoreReadyEffect(),
    })
    this.publicPrograms = publicNearPrograms(this, this.programs)
  }

  /**
   * The configured low-level JSON-RPC client.
   *
   * Use this as an escape hatch for advanced or low-level RPC calls that are
   * not wrapped by convenience methods on `Near` — for example
   * {@link RpcClient.receiptToTx}, {@link RpcClient.getBlock}, or
   * {@link RpcClient.getGasPrice}. The returned client is already configured
   * with this instance's network URL, headers, and retry settings.
   *
   * @example
   * ```typescript
   * const { transaction_hash, sender_account_id } =
   *   await near.rpc.receiptToTx("9ADoP8t3kRkV6JqYy3a6mJZ1uXuJ4Z3o2bF7tQwErTy")
   * ```
   */
  get rpc(): RpcClient {
    return this._rpc
  }

  /** Canonical native programs shared by the optional Effect entrypoint. */
  get effects(): NearEffects {
    return this.publicPrograms
  }

  get rpcEffects(): RpcPrograms {
    return this.nativeRpc
  }

  /**
   * Initialize RPC client from configuration
   * @internal
   */
  private _initializeRpc(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
    programs?: RpcPrograms,
  ): void {
    const networkConfig = resolveNetworkConfig(validatedConfig.network)
    const rpcUrl = validatedConfig.rpcUrl || networkConfig.rpcUrl
    this.nativeRpc =
      programs ??
      makeRpcProgramsUnsafe(
        {
          url: rpcUrl,
          ...(validatedConfig.headers
            ? { headers: validatedConfig.headers }
            : {}),
          ...(validatedConfig.retryConfig
            ? { retry: validatedConfig.retryConfig }
            : {}),
        },
        fetchTransport((url, init) => globalThis.fetch(url, init)),
      )
    this._rpc = rpcToPromises(this.nativeRpc)
    this.nativeRpc = rpcFromPromises(this._rpc)
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
      // Native initialization is shared by concurrent signing operations
      if (accountId) {
        this.pendingKeyStoreInit = keyStoreService(this.keyStore).add(
          accountId,
          keyPair,
        )
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
          // Native initialization is shared by concurrent signing operations
          this.pendingKeyStoreInit = keyStoreService(this.keyStore).add(
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
  private ensureKeyStoreReady(): Promise<void> {
    return runPromise(this.ensureKeyStoreReadyEffect())
  }

  /** Effect-native ensureKeyStoreReady operation. */
  private ensureKeyStoreReadyEffect(): Effect.Effect<void, ExternalError> {
    return this.pendingKeyStoreInit ?? Effect.void
  }

  /** Wait for configured keys to finish initialization in the caller's fiber. */
  get ready(): Effect.Effect<void, ExternalError> {
    return this.ensureKeyStoreReadyEffect()
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

  /** Effect-native getSignerId operation. */

  /**
   * Call a view function on a contract (read-only, no gas).
   *
   * @param contractId - Target contract account ID.
   * @param methodName - Name of the view method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional {@link BlockReference} to specify finality or block.
   *
   * @returns Parsed JSON result when the contract returns JSON, otherwise the
   * raw string value typed as `T`. Returns `undefined` when the contract returns
   * an empty response.
   *
   * @remarks
   * - View calls are free and do not require a signer or gas.
   * - Errors thrown by the contract surface as {@link ContractExecutionError}.
   * - The generic type `T` is a type assertion for convenience; no runtime
   *   validation is performed against `T`.
   *
   * @see NearConfig.defaultWaitUntil
   */
  view<T = unknown>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options?: BlockReference,
  ): Promise<T | undefined> {
    return runPromise(
      this.programs.view<T>(contractId, methodName, args, options),
    )
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
  call<T = FinalExecutionOutcome>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options: CallOptions = {},
  ): Promise<T> {
    return runPromise(
      this.programs.call<T>(contractId, methodName, args, options),
    )
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
  send(receiverId: string, amount: Amount): Promise<FinalExecutionOutcome> {
    return runPromise(this.programs.send(receiverId, amount))
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
  signMessage(
    params: SignMessageParams | Omit<SignMessageParams, "nonce">,
    options?: { signerId?: string },
  ): Promise<SignedMessage> {
    return runPromise(this.programs.signMessage(params, options))
  }

  /**
   * Calculate available balance from account data.
   *
   * The available balance accounts for the protocol rule that staked tokens
   * count towards the storage requirement:
   * - available = amount - max(0, storageRequired - locked)
   *
   * @internal
   */

  /**
   * Get the available (spendable) balance for an account in NEAR.
   *
   * This returns the amount that can actually be spent or transferred,
   * accounting for storage requirements. Staked tokens count towards
   * the storage requirement, so:
   * - If staked >= storage cost: all liquid balance is available
   * - If staked < storage cost: some liquid balance is reserved for storage
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Available balance formatted as a decimal string (e.g., "98.50").
   *
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * For the full account state including all balance fields, use {@link getAccount}.
   *
   * @example
   * ```typescript
   * const available = await near.getBalance("alice.near")
   * console.log(`Can spend: ${available} NEAR`)
   * ```
   */
  getBalance(accountId: string, options?: BlockReference): Promise<string> {
    return runPromise(this.programs.getBalance(accountId, options))
  }

  /**
   * Get complete account state including all balance information.
   *
   * Returns a user-friendly object with computed fields like `available`
   * (the actually spendable balance) and `storageUsage` (NEAR reserved for storage).
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Complete account state with all balance fields.
   *
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @example
   * ```typescript
   * const account = await near.getAccount("alice.near")
   * console.log(`Balance: ${account.balance} NEAR`)
   * console.log(`Available to spend: ${account.available} NEAR`)
   * console.log(`Staked: ${account.staked} NEAR`)
   * console.log(`Storage: ${account.storageUsage} NEAR (${account.storageBytes} bytes)`)
   * console.log(`Has contract: ${account.hasContract}`)
   * ```
   */
  getAccount(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccountState> {
    return runPromise(this.programs.getAccount(accountId, options))
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
  accountExists(accountId: string, options?: BlockReference): Promise<boolean> {
    return runPromise(this.programs.accountExists(accountId, options))
  }

  /**
   * Get access key information for an account.
   *
   * @param accountId - Account ID to check.
   * @param publicKey - Public key string (e.g., "ed25519:...").
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Access key information if it exists, `null` otherwise.
   *
   * @remarks
   * This method retrieves detailed information about a specific access key,
   * including its nonce and permission type (FullAccess or FunctionCall).
   *
   * @example
   * ```typescript
   * const accessKey = await near.getAccessKey("alice.near", "ed25519:...")
   * if (accessKey && accessKey.permission === "FullAccess") {
   *   console.log("Key is a full access key")
   * }
   * ```
   */
  getAccessKey(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<AccessKeyView | null> {
    return runPromise(this.programs.getAccessKey(accountId, publicKey, options))
  }

  /**
   * Get all access keys for an account.
   *
   * @param accountId - Account ID to list keys for.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns List of access keys with their public keys and permissions.
   *
   * @remarks
   * This method retrieves all access keys associated with an account,
   * including both full access keys and function call keys.
   *
   * @example
   * ```typescript
   * const keys = await near.getAccessKeys("alice.near")
   * for (const key of keys.keys) {
   *   console.log(key.public_key, key.access_key.permission)
   * }
   * ```
   */
  getAccessKeys(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccessKeyListResponse> {
    return runPromise(this.programs.getAccessKeys(accountId, options))
  }

  /**
   * Get the WASM code deployed on a contract account.
   *
   * @param accountId - Account whose contract code to fetch.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The contract's WASM bytecode and its base58-encoded SHA-256 hash.
   *
   * @throws {ContractNotDeployedError} If the account has no contract deployed.
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * If you only need the code hash, {@link getAccount} returns it without
   * downloading the code itself.
   *
   * @example
   * ```typescript
   * const { code, hash } = await near.getContractCode("contract.near")
   * console.log(`${code.length} bytes, hash ${hash}`)
   * ```
   */
  getContractCode(
    accountId: string,
    options?: BlockReference,
  ): Promise<ContractCodeResult> {
    return runPromise(this.programs.getContractCode(accountId, options))
  }

  /**
   * Get a contract published in the global contract registry.
   *
   * Accepts the same reference shape as
   * {@link TransactionBuilder.deployFromPublished}: `{ codeHash }` for
   * immutable contracts or `{ accountId }` for updatable ones.
   *
   * @param contract - {@link GlobalContractReference} identifying the published contract.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The published WASM bytecode and its base58-encoded SHA-256 hash.
   *
   * @throws {GlobalContractNotFoundError} If no code is published under the identifier.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * Requires a nearcore >= 2.7 node. For updatable contracts (`{ accountId }`),
   * the returned `hash` is the current version's code hash — compare it against
   * a locally computed hash to detect upstream updates.
   *
   * @example
   * ```typescript
   * // Current code published by a factory (updatable)
   * const { code, hash } = await near.getGlobalContract({
   *   accountId: "factory.near",
   * })
   *
   * // Immutable contract by its code hash
   * const published = await near.getGlobalContract({ codeHash: "9wa3..." })
   * ```
   */
  getGlobalContract(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<ContractCodeResult> {
    return runPromise(this.programs.getGlobalContract(contract, options))
  }

  /**
   * Check whether a contract is published in the global contract registry.
   *
   * @param contract - {@link GlobalContractReference} identifying the published contract.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns `true` if code is published under the identifier, `false` otherwise.
   *
   * @remarks
   * Only "not found" results map to `false`; other failures (network errors,
   * unsupported node version) are re-thrown. The underlying RPC returns the
   * full WASM code — there is no lighter hash-only query — so prefer caching
   * the result over calling this in a hot path.
   *
   * @example
   * ```typescript
   * if (await near.globalContractExists({ accountId: "factory.near" })) {
   *   // safe to deployFromPublished
   * }
   * ```
   */
  globalContractExists(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<boolean> {
    return runPromise(this.programs.globalContractExists(contract, options))
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
  getTransactionStatus<
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
    return runPromise(
      this.programs.getTransactionStatus<W>(txHash, senderAccountId, waitUntil),
    )
  }

  /**
   * Get network status information.
   *
   * @returns The full network status response from the RPC.
   */
  getStatus(): Promise<StatusResponse> {
    return runPromise(this.programs.getStatus())
  }

  /**
   * Read a single page of a contract's state via `view_state`.
   *
   * Returns base64-encoded key/value entries. Use `options.afterKey` (the
   * `last_key` from a previous page) to paginate, or {@link viewStateAll} to
   * iterate everything.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional `prefix`, `afterKey`, `limit`, `includeProof`, and block reference.
   */
  viewState(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Promise<ViewStateResult> {
    return runPromise(this.programs.viewState(accountId, options))
  }

  /**
   * Iterate every entry of a contract's state via `view_state`, following the
   * pagination cursor across pages.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional `prefix`, per-request `limit`, and block reference.
   *
   * @example
   * ```typescript
   * for await (const { key, value } of near.viewStateAll("contract.near")) {
   *   // process each entry
   * }
   * ```
   */
  viewStateAll(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): AsyncGenerator<StateItem> {
    return this._rpc.viewStateAll(accountId, options)
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
  batch<T extends unknown[]>(
    ...promises: Array<Promise<T[number]>>
  ): Promise<T> {
    return runPromise(this.programs.batch<T>(...promises))
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
      this._rpc,
      this.keyStore,
      this.signer,
      this.defaultWaitUntil,
      this.wallet,
      this.pendingKeyStoreInit ? () => this.ensureKeyStoreReady() : undefined,
      this.pendingKeyStoreInit
        ? () => this.ensureKeyStoreReadyEffect()
        : undefined,
      this.nonceReservation,
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

// oxlint-disable typescript/unbound-method -- Function identities honor public overrides without invoking methods unbound.
const originalMethods = {
  view: Near.prototype.view,
  call: Near.prototype.call,
  send: Near.prototype.send,
  signMessage: Near.prototype.signMessage,
  getBalance: Near.prototype.getBalance,
  getAccount: Near.prototype.getAccount,
  accountExists: Near.prototype.accountExists,
  getAccessKey: Near.prototype.getAccessKey,
  getAccessKeys: Near.prototype.getAccessKeys,
  getContractCode: Near.prototype.getContractCode,
  getGlobalContract: Near.prototype.getGlobalContract,
  globalContractExists: Near.prototype.globalContractExists,
  getTransactionStatus: Near.prototype.getTransactionStatus,
  getStatus: Near.prototype.getStatus,
  viewState: Near.prototype.viewState,
  batch: Near.prototype.batch,
}
// oxlint-enable typescript/unbound-method

function publicNearPrograms(near: Near, programs: NearPrograms) {
  return {
    ...programs,
    view<T = unknown>(
      this: void,
      contractId: string,
      methodName: string,
      args: object | Uint8Array = {},
      options?: BlockReference,
    ): Effect.Effect<T | undefined, NearFailure> {
      return Effect.suspend(() =>
        near.view === originalMethods.view
          ? programs.view<T>(contractId, methodName, args, options)
          : fromPromise(
              () => near.view<T>(contractId, methodName, args, options),
              "Near.view",
            ),
      )
    },
    call<T = FinalExecutionOutcome>(
      this: void,
      contractId: string,
      methodName: string,
      args: object | Uint8Array = {},
      options: CallOptions = {},
    ): Effect.Effect<T, NearFailure> {
      return Effect.suspend(() =>
        near.call === originalMethods.call
          ? programs.call<T>(contractId, methodName, args, options)
          : fromPromise(
              () => near.call<T>(contractId, methodName, args, options),
              "Near.call",
            ),
      )
    },
    send(
      this: void,
      receiverId: string,
      amount: Amount,
    ): Effect.Effect<FinalExecutionOutcome, NearFailure> {
      return Effect.suspend(() =>
        near.send === originalMethods.send
          ? programs.send(receiverId, amount)
          : fromPromise(() => near.send(receiverId, amount), "Near.send"),
      )
    },
    signMessage(
      this: void,
      params: SignMessageParams | Omit<SignMessageParams, "nonce">,
      options?: { signerId?: string },
    ): Effect.Effect<SignedMessage, NearFailure> {
      return Effect.suspend(() =>
        near.signMessage === originalMethods.signMessage
          ? programs.signMessage(params, options)
          : fromPromise(
              () => near.signMessage(params, options),
              "Near.signMessage",
            ),
      )
    },
    getBalance(
      this: void,
      accountId: string,
      options?: BlockReference,
    ): Effect.Effect<string, NearFailure> {
      return Effect.suspend(() =>
        near.getBalance === originalMethods.getBalance
          ? programs.getBalance(accountId, options)
          : fromPromise(
              () => near.getBalance(accountId, options),
              "Near.getBalance",
            ),
      )
    },
    getAccount(
      this: void,
      accountId: string,
      options?: BlockReference,
    ): Effect.Effect<AccountState, NearFailure> {
      return Effect.suspend(() =>
        near.getAccount === originalMethods.getAccount
          ? programs.getAccount(accountId, options)
          : fromPromise(
              () => near.getAccount(accountId, options),
              "Near.getAccount",
            ),
      )
    },
    accountExists(
      this: void,
      accountId: string,
      options?: BlockReference,
    ): Effect.Effect<boolean, NearFailure> {
      return Effect.suspend(() =>
        near.accountExists === originalMethods.accountExists
          ? programs.accountExists(accountId, options)
          : fromPromise(
              () => near.accountExists(accountId, options),
              "Near.accountExists",
            ),
      )
    },
    getAccessKey(
      this: void,
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Effect.Effect<AccessKeyView | null, NearFailure> {
      return Effect.suspend(() =>
        near.getAccessKey === originalMethods.getAccessKey
          ? programs.getAccessKey(accountId, publicKey, options)
          : fromPromise(
              () => near.getAccessKey(accountId, publicKey, options),
              "Near.getAccessKey",
            ),
      )
    },
    getAccessKeys(
      this: void,
      accountId: string,
      options?: BlockReference,
    ): Effect.Effect<AccessKeyListResponse, NearFailure> {
      return Effect.suspend(() =>
        near.getAccessKeys === originalMethods.getAccessKeys
          ? programs.getAccessKeys(accountId, options)
          : fromPromise(
              () => near.getAccessKeys(accountId, options),
              "Near.getAccessKeys",
            ),
      )
    },
    getContractCode(
      this: void,
      accountId: string,
      options?: BlockReference,
    ): Effect.Effect<ContractCodeResult, NearFailure> {
      return Effect.suspend(() =>
        near.getContractCode === originalMethods.getContractCode
          ? programs.getContractCode(accountId, options)
          : fromPromise(
              () => near.getContractCode(accountId, options),
              "Near.getContractCode",
            ),
      )
    },
    getGlobalContract(
      this: void,
      contract: GlobalContractReference,
      options?: BlockReference,
    ): Effect.Effect<ContractCodeResult, NearFailure> {
      return Effect.suspend(() =>
        near.getGlobalContract === originalMethods.getGlobalContract
          ? programs.getGlobalContract(contract, options)
          : fromPromise(
              () => near.getGlobalContract(contract, options),
              "Near.getGlobalContract",
            ),
      )
    },
    globalContractExists(
      this: void,
      contract: GlobalContractReference,
      options?: BlockReference,
    ): Effect.Effect<boolean, NearFailure> {
      return Effect.suspend(() =>
        near.globalContractExists === originalMethods.globalContractExists
          ? programs.globalContractExists(contract, options)
          : fromPromise(
              () => near.globalContractExists(contract, options),
              "Near.globalContractExists",
            ),
      )
    },
    getTransactionStatus<
      W extends
        | "NONE"
        | "INCLUDED"
        | "EXECUTED_OPTIMISTIC"
        | "INCLUDED_FINAL"
        | "EXECUTED"
        | "FINAL" = "EXECUTED_OPTIMISTIC",
    >(
      this: void,
      txHash: string,
      senderAccountId: string,
      waitUntil?: W,
    ): Effect.Effect<
      W extends keyof FinalExecutionOutcomeWithReceiptsMap
        ? FinalExecutionOutcomeWithReceiptsMap[W]
        : never,
      NearFailure
    > {
      return Effect.suspend(() =>
        near.getTransactionStatus === originalMethods.getTransactionStatus
          ? programs.getTransactionStatus<W>(txHash, senderAccountId, waitUntil)
          : fromPromise(
              () =>
                near.getTransactionStatus<W>(
                  txHash,
                  senderAccountId,
                  waitUntil,
                ),
              "Near.getTransactionStatus",
            ),
      )
    },
    getStatus(this: void): Effect.Effect<StatusResponse, NearFailure> {
      return Effect.suspend(() =>
        near.getStatus === originalMethods.getStatus
          ? programs.getStatus()
          : fromPromise(() => near.getStatus(), "Near.getStatus"),
      )
    },
    viewState(
      this: void,
      accountId: string,
      options?: BlockReference & {
        prefix?: string
        afterKey?: string
        limit?: number
        includeProof?: boolean
      },
    ): Effect.Effect<ViewStateResult, NearFailure> {
      return Effect.suspend(() =>
        near.viewState === originalMethods.viewState
          ? programs.viewState(accountId, options)
          : fromPromise(
              () => near.viewState(accountId, options),
              "Near.viewState",
            ),
      )
    },
    batch<T extends unknown[]>(
      this: void,
      ...promises: Array<Promise<T[number]>>
    ): Effect.Effect<T, NearFailure> {
      return Effect.suspend(() =>
        near.batch === originalMethods.batch
          ? programs.batch<T>(...promises)
          : fromPromise(() => near.batch<T>(...promises), "Near.batch"),
      )
    },
  }
}

export type NearEffects = ReturnType<typeof publicNearPrograms>
