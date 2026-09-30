import { Effect } from "effect"
import { expect, test } from "vitest"
import type {
  SignDelegateActionsParams,
  SignMessageParams,
  WalletConnection,
} from "../../src/core/types.js"
import { ExternalError, runPromise } from "../../src/effect/runtime.js"
import { walletConnection, walletService } from "../../src/effect/wallet.js"

// Connector-specific suites own action encoding. This guards the shared
// structural application-wallet boundary used by native Near and transactions.
test("structural wallet methods retain their receiver, inputs, and exact rejections", async () => {
  const rejection = { reason: "user denied signing" }
  const application = {
    accountId: "alice.near",
    received: [] as unknown[],
    async getAccounts() {
      return [{ accountId: this.accountId }]
    },
    async signAndSendTransaction(
      params: Parameters<WalletConnection["signAndSendTransaction"]>[0],
    ): Promise<never> {
      this.received.push(params)
      throw rejection
    },
    async signMessage(params: SignMessageParams) {
      this.received.push(params)
      return {
        accountId: this.accountId,
        publicKey: "ed25519:public",
        signature: "ed25519:signed",
      }
    },
    async signDelegateActions(params: SignDelegateActionsParams) {
      this.received.push(params)
      return { signedDelegateActions: [] }
    },
  }
  const service = walletService(application)
  const connection = walletConnection(service)
  expect(await runPromise(service.getAccounts())).toEqual([
    { accountId: "alice.near" },
  ])
  const transaction = { receiverId: "contract.near", actions: [] }
  const error = await Effect.runPromise(
    service.signAndSendTransaction(transaction).pipe(Effect.flip),
  )
  expect(error).toBeInstanceOf(ExternalError)
  expect(error.cause).toBe(rejection)
  await expect(connection.signAndSendTransaction(transaction)).rejects.toBe(
    rejection,
  )
  if (!connection.signMessage || !connection.signDelegateActions)
    throw new Error("missing optional wallet methods")
  const message = {
    message: "login",
    recipient: "app",
    nonce: new Uint8Array(32),
  }
  expect(await connection.signMessage(message)).toEqual({
    accountId: "alice.near",
    publicKey: "ed25519:public",
    signature: "ed25519:signed",
  })
  const delegates = { signerId: "alice.near", delegateActions: [] }
  expect(await connection.signDelegateActions(delegates)).toEqual({
    signedDelegateActions: [],
  })
  expect(application.received).toEqual([
    transaction,
    transaction,
    message,
    delegates,
  ])
})
