import { afterEach, describe, expect, it, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import type { TxExecutionStatus } from "../../src/core/types.js"
import { InvalidTransactionError } from "../../src/errors/index.js"
import { fromWalletSelector } from "../../src/wallets/adapters.js"
import { MockWalletSelector } from "./mock-wallets.js"

async function setup(
  level: TxExecutionStatus,
  defaultWaitUntil?: TxExecutionStatus,
) {
  const wallet = new MockWalletSelector([{ accountId: "alice.testnet" }])
  const outcome = await wallet.signAndSendTransaction({
    receiverId: "bob.testnet",
    actions: [],
  })
  const signing = vi.spyOn(wallet, "signAndSendTransaction").mockResolvedValue({
    ...outcome,
    final_execution_status: level,
  } as typeof outcome)
  const near = new Near({
    network: "testnet",
    wallet: fromWalletSelector(wallet),
    ...(defaultWaitUntil && { defaultWaitUntil }),
  })
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        result: { ...outcome, receipts: [] },
      }),
    ),
  )
  vi.stubGlobal("fetch", fetch)
  return { near, signing, fetch, outcome }
}
afterEach(() => vi.unstubAllGlobals())
describe("wallet transaction finality", () => {
  it("waits for explicit FINAL using the submitted hash", async () => {
    const { near, signing, fetch } = await setup("EXECUTED_OPTIMISTIC")
    const result = await near
      .transaction("alice.testnet")
      .transfer("bob.testnet", "1 NEAR")
      .send({ waitUntil: "FINAL" })
    expect(result.final_execution_status).toBe("FINAL")
    expect(signing).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({
      method: "EXPERIMENTAL_tx_status",
      params: {
        tx_hash: "mock-tx-hash",
        sender_account_id: "alice.testnet",
        wait_until: "FINAL",
      },
    })
  })
  it("queries the account that actually signed the returned transaction", async () => {
    const { near, signing, fetch, outcome } = await setup("EXECUTED_OPTIMISTIC")
    if (!outcome.transaction) throw new Error("Missing fixture transaction")
    signing.mockResolvedValue({
      ...outcome,
      final_execution_status: "EXECUTED_OPTIMISTIC",
      transaction: { ...outcome.transaction, signer_id: "selected.testnet" },
    })
    await near
      .transaction("alice.testnet")
      .transfer("bob.testnet", "1 NEAR")
      .send({ waitUntil: "FINAL" })
    expect(
      JSON.parse(fetch.mock.calls[0]?.[1].body).params.sender_account_id,
    ).toBe("selected.testnet")
  })
  it.each([
    "builder",
    "call",
    "send",
  ])("honors configured FINAL through %s", async (method) => {
    const { near, fetch } = await setup("EXECUTED_OPTIMISTIC", "FINAL")
    if (method === "builder")
      await near
        .transaction("alice.testnet")
        .transfer("bob.testnet", "1 NEAR")
        .send()
    else if (method === "call") await near.call("bob.testnet", "check_in", {})
    else await near.send("bob.testnet", "1 NEAR")
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).params.wait_until).toBe(
      "FINAL",
    )
  })
  it("honors explicit FINAL through call", async () => {
    const { near, fetch } = await setup("EXECUTED_OPTIMISTIC")
    await near.call("bob.testnet", "check_in", {}, { waitUntil: "FINAL" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    ["FINAL", "FINAL", false],
    ["EXECUTED", "EXECUTED_OPTIMISTIC", false],
    ["EXECUTED_OPTIMISTIC", "INCLUDED", false],
    ["INCLUDED_FINAL", "EXECUTED_OPTIMISTIC", true],
    ["EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", true],
  ] as const)("%s satisfies %s: reconcile=%s", async (level, requested, reconcile) => {
    const { near, fetch } = await setup(level)
    await near
      .transaction("alice.testnet")
      .transfer("bob.testnet", "1 NEAR")
      .send({ waitUntil: requested })
    expect(fetch).toHaveBeenCalledTimes(reconcile ? 1 : 0)
  })
  it("raises typed execution errors even when the wallet reports FINAL", async () => {
    const { near, signing, fetch, outcome } = await setup("FINAL")
    const failure = {
      ...outcome,
      status: {
        Failure: {
          ActionError: {
            index: 0,
            kind: { AccountAlreadyExists: { account_id: "bob.testnet" } },
          },
        },
      },
    }
    signing.mockResolvedValue(failure)
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "test",
          result: { ...failure, receipts: [] },
        }),
      ),
    )
    await expect(near.send("bob.testnet", "1 NEAR")).rejects.toBeInstanceOf(
      InvalidTransactionError,
    )
    expect(signing).toHaveBeenCalledTimes(1)
  })
  it("lets an explicit wait level override configured FINAL", async () => {
    const { near, fetch } = await setup("EXECUTED_OPTIMISTIC", "FINAL")
    await near
      .transaction("alice.testnet")
      .transfer("bob.testnet", "1 NEAR")
      .send({ waitUntil: "INCLUDED" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("fails without resubmitting when a wallet omits the hash", async () => {
    const { near, signing, fetch } = await setup("EXECUTED_OPTIMISTIC")
    signing.mockResolvedValue({ final_execution_status: "NONE" })
    await expect(near.send("bob.testnet", "1 NEAR")).rejects.toThrow(
      "Wallet did not return a transaction hash",
    )
    expect(signing).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("never signs again when reconciliation fails", async () => {
    const { near, signing } = await setup("EXECUTED_OPTIMISTIC")
    vi.spyOn(near.rpc, "getTransactionStatus").mockRejectedValue(
      new Error("RPC unavailable"),
    )
    await expect(
      near
        .transaction("alice.testnet")
        .transfer("bob.testnet", "1 NEAR")
        .send({ waitUntil: "FINAL" }),
    ).rejects.toThrow("RPC unavailable")
    expect(signing).toHaveBeenCalledTimes(1)
  })
})
