import { afterEach, describe, expect, test, vi } from "vitest"
import type { RpcClient } from "../../src/core/rpc/rpc.js"
import { SignedTransactionSchema } from "../../src/core/schema.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import type { WalletConnection } from "../../src/core/types.js"
import { NearError } from "../../src/errors/index.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"

const BLOCK_HASH = "GVgoqd4XN1r7VEde3bpw2qH1FYvjJR3z8dXJ5C5FQuUL"

async function setup(wallet?: WalletConnection) {
  const accountId = `delegate-nonce-${Math.random().toString(36).slice(2)}.near`
  const key = generateKey()
  const keyStore = new InMemoryKeyStore()
  await keyStore.add(accountId, key)
  const getKey = vi.spyOn(keyStore, "get")
  const sign = vi.spyOn(key, "sign")
  const ensureKeyStoreReady = vi.fn(async () => {})
  const rpc = {
    getAccessKey: vi.fn(async () => ({
      nonce: 10,
      permission: "FullAccess",
      block_hash: BLOCK_HASH,
      block_height: 100,
    })),
    getStatus: vi.fn(async () => ({
      sync_info: { latest_block_height: 100 },
    })),
    getBlock: vi.fn(async () => ({
      header: { hash: BLOCK_HASH, height: 100 },
    })),
    call: vi.fn(async () => ({ nonces: [10, 20, 30] })),
  }
  const builder = () =>
    new TransactionBuilder(
      accountId,
      rpc as unknown as RpcClient,
      keyStore,
      undefined,
      "EXECUTED_OPTIMISTIC",
      wallet,
      ensureKeyStoreReady,
    )
  const expectNoSideEffects = () => {
    expect(ensureKeyStoreReady).not.toHaveBeenCalled()
    expect(getKey).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
    for (const call of Object.values(rpc)) {
      expect(call).not.toHaveBeenCalled()
    }
  }
  return { builder, rpc, expectNoSideEffects }
}

afterEach(() => vi.restoreAllMocks())

describe.each(["delegate", "delegateV2"] as const)(
  "%s with an explicit transaction nonce",
  (method) => {
    test.each([
      ["omitted", undefined],
      ["equal", { nonce: 42n }],
      ["different", { nonce: 43n }],
    ] as const)(
      "rejects with %s delegate nonce before key access, RPC calls, or signing",
      async (_label, options) => {
        const { builder, expectNoSideEffects } = await setup()
        const result = builder()
          .nonce(42n)
          .transfer("bob.near", "1 NEAR")
          [method](options)

        await expect(result).rejects.toBeInstanceOf(NearError)
        await expect(result).rejects.toMatchObject({
          code: "INVALID_TRANSACTION",
          message: expect.stringContaining(`Use ${method}({ nonce })`),
        })
        expectNoSideEffects()
      },
    )

    test.each([undefined, { nonce: 42n }, { nonce: 43n }])(
      "rejects before a connected wallet is prompted (%o)",
      async (options) => {
        const wallet = {
          getAccounts: vi.fn(async () => []),
          signAndSendTransaction: vi.fn(async () => {
            throw new Error("must not prompt")
          }),
          signDelegateActions: vi.fn(async () => {
            throw new Error("must not prompt")
          }),
        }
        const { builder, expectNoSideEffects } = await setup(wallet)

        await expect(
          builder().nonce(42n).transfer("bob.near", "1 NEAR")[method](options),
        ).rejects.toMatchObject({ code: "INVALID_TRANSACTION" })

        expectNoSideEffects()
        expect(wallet.getAccounts).not.toHaveBeenCalled()
        expect(wallet.signAndSendTransaction).not.toHaveBeenCalled()
        expect(wallet.signDelegateActions).not.toHaveBeenCalled()
      },
    )
  },
)

test.each([undefined, 42n, 43n])(
  "delegateV2 rejects a transaction nonce with nonceIndex and delegate nonce %s",
  async (nonce) => {
    const { builder, expectNoSideEffects } = await setup()

    await expect(
      builder()
        .nonce(42n)
        .transfer("bob.near", "1 NEAR")
        .delegateV2({
          nonceIndex: 2,
          ...(nonce === undefined ? {} : { nonce }),
        }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION" })

    expectNoSideEffects()
  },
)

test("delegate keeps its local nonce option and an independent relayer nonce", async () => {
  const { builder, rpc } = await setup()
  const { signedDelegateAction } = await builder()
    .transfer("bob.near", "1 NEAR")
    .delegate({ nonce: 43n, maxBlockHeight: 999n })

  expect(signedDelegateAction.signedDelegate.delegateAction.nonce).toBe(43n)
  expect(rpc.getAccessKey).not.toHaveBeenCalled()
  expect(rpc.getStatus).not.toHaveBeenCalled()

  const outer = await builder()
    .nonce(42n)
    .signedDelegateAction(signedDelegateAction)
    .sign()
  const decoded = SignedTransactionSchema.deserialize(outer.serialize())
  expect(decoded.transaction).toMatchObject({
    nonce: 42n,
    actions: [{ signedDelegate: { delegateAction: { nonce: 43n } } }],
  })
  expect(signedDelegateAction.signedDelegate.delegateAction.nonce).toBe(43n)
})

test.each([undefined, 2])(
  "delegateV2 keeps its local nonce option, slot %s, and independent relayer nonce",
  async (nonceIndex) => {
    const { builder, rpc } = await setup()
    const { signedDelegateAction } = await builder()
      .transfer("bob.near", "1 NEAR")
      .delegateV2({
        nonce: 43n,
        maxBlockHeight: 999n,
        ...(nonceIndex === undefined ? {} : { nonceIndex }),
      })

    const expected =
      nonceIndex === undefined
        ? { nonce: { nonce: 43n } }
        : { gasKeyNonce: { nonce: 43n, nonceIndex } }
    expect(signedDelegateAction.delegateV2.delegateAction.v2.nonce).toEqual(
      expected,
    )
    expect(rpc.getAccessKey).not.toHaveBeenCalled()
    expect(rpc.getStatus).not.toHaveBeenCalled()
    expect(rpc.call).not.toHaveBeenCalled()

    const outer = await builder()
      .nonce(42n)
      .signedDelegateActionV2(signedDelegateAction)
      .sign()
    const decoded = SignedTransactionSchema.deserialize(outer.serialize())
    expect(decoded.transaction).toMatchObject({
      nonce: 42n,
      actions: [
        { delegateV2: { delegateAction: { v2: { nonce: expected } } } },
      ],
    })
    expect(signedDelegateAction.delegateV2.delegateAction.v2.nonce).toEqual(
      expected,
    )
  },
)

test("delegate still prompts a wallet when no transaction nonce is set", async () => {
  const { builder: localBuilder } = await setup()
  const { signedDelegateAction } = await localBuilder()
    .transfer("bob.near", "1 NEAR")
    .delegate({ nonce: 11n, maxBlockHeight: 999n })
  const wallet = {
    getAccounts: vi.fn(async () => []),
    signAndSendTransaction: vi.fn(async () => {
      throw new Error("must not send")
    }),
    signDelegateActions: vi.fn(async () => ({
      signedDelegateActions: [
        {
          signedDelegate: signedDelegateAction,
          delegateHash: new Uint8Array(32),
        },
      ],
    })),
  }
  const { builder, expectNoSideEffects } = await setup(wallet)
  const result = await builder().transfer("bob.near", "1 NEAR").delegate()

  expect(result.signedDelegateAction).toEqual(signedDelegateAction)
  expect(wallet.signDelegateActions).toHaveBeenCalledTimes(1)
  expectNoSideEffects()
})
