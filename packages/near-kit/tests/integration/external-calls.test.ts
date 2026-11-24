/**
 * External contract calls (NEP-667) against a nearcore 2.15 sandbox.
 *
 * tests/contracts/external-call.wat logs "checked" from `__external_call`,
 * then refuses a payload starting with 0xFF (it traps), accepts one starting
 * with "p" and makes a 1 yoctoNEAR transfer to itself, and accepts anything
 * else. An accepted call returns its payload.
 *
 * The tests skip on a node below protocol version 89, such as when
 * NEAR_SANDBOX_BIN_PATH points at a 2.14 binary.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hex } from "@scure/base"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  externalCallHash,
  externalCallUniqueId,
} from "../../src/core/external-call.js"
import { Near } from "../../src/core/near.js"
import type { ReceiptView } from "../../src/core/types.js"
import {
  ContractNotDeployedError,
  ExternalCallRefusedError,
  ExternalCallTimeoutError,
  FunctionCallError,
  InvalidStateInitError,
  ReservedMethodNameError,
  UninitializedAccountError,
} from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"

const WASM = readFileSync(resolve(__dirname, "../contracts/external-call.wasm"))

let counter = 0
const unique = () => `${Date.now()}-${counter++}`
const bytes = (prefix: string | number, rest = unique()) =>
  Uint8Array.from([
    ...(typeof prefix === "number"
      ? [prefix]
      : new TextEncoder().encode(prefix)),
    ...new TextEncoder().encode(rest),
  ])

const actionOf = (receipt: ReceiptView) =>
  (receipt.receipt as { Action?: Record<string, unknown> }).Action

describe("external calls (nearcore 2.15)", () => {
  let sandbox: Sandbox
  let near: Near
  let supported = false
  let contract: string
  let plain: string

  beforeAll(async () => {
    sandbox = await Sandbox.start({ version: "2.15.0-rc.1" })
    near = new Near({ network: sandbox })
    supported = (await near.getStatus()).protocol_version >= 89
    if (!supported) return

    const root = sandbox.rootAccount.id
    contract = `ecc-${Date.now()}.${root}`
    plain = `plain-${Date.now()}.${root}`
    await near
      .transaction(root)
      .createAccount(contract)
      .transfer(contract, "10 NEAR")
      .deployContract(contract, WASM)
      .send({ waitUntil: "FINAL" })
    await near
      .transaction(root)
      .createAccount(plain)
      .transfer(plain, "1 NEAR")
      .send({ waitUntil: "FINAL" })
  }, 120000)

  afterAll(async () => {
    await sandbox?.stop()
  })

  describe("dry run", () => {
    test("returns an accepted call's result", async (ctx) => {
      if (!supported) ctx.skip()
      expect(await near.viewExternalCall(contract, { n: 1 })).toEqual({ n: 1 })
    })

    test("a refusal carries the reason and the run's logs", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .viewExternalCall(contract, bytes(0xff))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallRefusedError)
      const refusal = error as ExternalCallRefusedError
      expect(refusal.contractId).toBe(contract)
      expect(refusal.logs).toEqual(["checked"])
      expect(refusal.blockHeight).toBeGreaterThan(0)
      expect(refusal.error).toMatchObject({
        ActionError: { kind: { FunctionCallError: {} } },
      })
    })

    test("an account without a contract is refused before any run", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .viewExternalCall(plain, bytes("a"))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallRefusedError)
      expect((error as ExternalCallRefusedError).error).toEqual({
        InvalidTxError: { ContractNotFound: { contract_id: plain } },
      })
      expect((error as ExternalCallRefusedError).logs).toEqual([])
    })
  })

  describe("send", () => {
    test("lands, under the unique id of its call hash and height", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("p")
      const outcome = await near.externalCall(contract, payload, {
        waitUntil: "EXECUTED_OPTIMISTIC",
      })

      expect(outcome.transaction).toMatchObject({
        kind: "external_call",
        contract_id: contract,
        state_init: null,
      })
      expect(outcome.transaction_outcome.outcome.logs).toEqual(["checked"])
      const uniqueId = outcome.transaction_outcome.id
      expect(outcome.transaction.transaction_id).toBe(uniqueId)

      const landedIn = await near.rpc.getBlock({
        blockId: outcome.transaction_outcome.block_hash,
      })
      expect(
        externalCallUniqueId(
          { contractId: contract, payload },
          landedIn.header.height,
        ),
      ).toBe(uniqueId)

      // `tx` takes the unique id, with the contract as the sender.
      const viaTx = (await near.rpc.call("tx", {
        tx_hash: uniqueId,
        sender_account_id: contract,
        wait_until: "FINAL",
      })) as { transaction: { transaction_id: string } }
      expect(viaTx.transaction.transaction_id).toBe(uniqueId)

      const status = await near.getExternalCallStatus(
        uniqueId,
        contract,
        "FINAL",
      )
      expect(status.final_execution_status).toBe("FINAL")
      expect(status.receipts.length).toBeGreaterThan(0)
      for (const receipt of status.receipts) {
        const action = actionOf(receipt)
        expect(action?.["authorization_context"]).toBe("ExternalContractCall")
        expect(action?.["signer_public_key"]).toBeUndefined()
        expect(action?.["creation_protocol_version"]).toBe(89)
      }
      const transfer = status.receipts.find(
        (receipt) => receipt.predecessor_id === contract,
      )
      expect(transfer?.receiver_id).toBe(contract)
    }, 60000)

    test("records its state changes under external_call_processing", async (ctx) => {
      if (!supported) ctx.skip()
      const outcome = await near.externalCall(contract, bytes("a"), {
        waitUntil: "FINAL",
      })
      const changes = (await near.rpc.call("EXPERIMENTAL_changes", {
        block_id: outcome.transaction_outcome.block_hash,
        changes_type: "account_changes",
        account_ids: [contract],
      })) as { changes: { cause: unknown }[] }
      expect(changes.changes.map((change) => change.cause)).toContainEqual({
        type: "external_call_processing",
        transaction_id: outcome.transaction_outcome.id,
      })
    }, 60000)

    test("a call to an account without a contract is rejected at once", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(near.externalCall(plain, bytes("a"))).rejects.toBeInstanceOf(
        ContractNotDeployedError,
      )
    })

    test("a refused call is never found: the send times out", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes(0xff)
      const error = await near
        .externalCall(contract, payload, { waitUntil: "INCLUDED" })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallTimeoutError)
      const timeout = error as ExternalCallTimeoutError
      expect(timeout.callHash).toBe(
        externalCallHash({ contractId: contract, payload }),
      )

      const head = (await near.rpc.getBlock({ finality: "optimistic" })).header
        .height
      expect(
        await near.findExternalCall(contract, payload, {
          fromHeight: timeout.sentAtHeight,
          toHeight: head,
        }),
      ).toBeUndefined()
    }, 60000)
  })

  describe("finding a copy", () => {
    test("by searching one candidate id per height", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("a")
      const fromHeight = (await near.rpc.getBlock({ finality: "optimistic" }))
        .header.height
      const sent = await near.externalCall(contract, payload, {
        waitUntil: "NONE",
      })
      expect(sent).toEqual({ final_execution_status: "NONE" })

      const found = await near.findExternalCall(contract, payload, {
        fromHeight,
        toHeight: fromHeight + 20,
        pollIntervalMs: 200,
        waitUntil: "FINAL",
      })
      expect(found?.transaction.contract_id).toBe(contract)
      expect(found?.final_execution_status).toBe("FINAL")
    }, 60000)

    test("by sending the same call again", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("a")
      const first = await near.externalCall(contract, payload, {
        waitUntil: "FINAL",
      })
      const found = await near.findExternalCall(contract, payload, {
        fromHeight: 0,
        resend: true,
        waitUntil: "FINAL",
      })
      expect(found?.transaction_outcome.id).toBe(first.transaction_outcome.id)
    }, 60000)
  })

  describe("signed transactions on 2.15", () => {
    test("receipts carry the signing key as their authorization context", async (ctx) => {
      if (!supported) ctx.skip()
      const root = sandbox.rootAccount.id
      const sent = await near
        .transaction(root)
        .transfer(plain, "1 yocto")
        .send({ waitUntil: "FINAL" })
      const status = await near.rpc.getTransactionStatus(
        sent.transaction.hash,
        root,
        "FINAL",
      )
      const action = actionOf(status.receipts[0] as ReceiptView)
      expect(action?.["authorization_context"]).toEqual({
        AccessKey: action?.["signer_public_key"],
      })
    }, 60000)

    test("a FunctionCall to __external_call is refused", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(
        near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contract, "__external_call", new Uint8Array([0x61]), {
            gas: "30 Tgas",
          })
          .send(),
      ).rejects.toBeInstanceOf(ReservedMethodNameError)
    }, 60000)
  })

  describe("uninitialized universal account", () => {
    // A key-only universal account and its state init, from the vectors
    // near-primitives produced.
    const vectors = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../fixtures/nearcore-2.15/near-primitives-vectors.json",
        ),
        "utf8",
      ),
    ) as {
      external_calls: {
        name: string
        contract_id: string
        state_init: string | null
      }[]
    }
    const universal = vectors.external_calls.find((v) =>
      v.name.startsWith("universal"),
    )
    const accountId = universal?.contract_id as string
    const stateInit = hex.decode(universal?.state_init as string)

    beforeAll(async () => {
      if (!supported) return
      await near
        .transaction(sandbox.rootAccount.id)
        .transfer(accountId, "1 NEAR")
        .send({ waitUntil: "FINAL" })
    }, 60000)

    test("a view needs its state init", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(near.view(accountId, "anything")).rejects.toBeInstanceOf(
        UninitializedAccountError,
      )
    })

    test("a state init for another account is invalid", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .view(
          accountId,
          "anything",
          {},
          {
            stateInit: { universal: new Uint8Array(10) },
          },
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidStateInitError)
      expect((error as InvalidStateInitError).details).toMatchObject({
        InvalidUniversalStateInitReceiver: { receiver_id: accountId },
      })
    })

    test("its own state init gets past validation to the missing code", async (ctx) => {
      if (!supported) ctx.skip()
      // The vector's state init installs keys only, so there is no code to run.
      const view = await near
        .view(
          accountId,
          "anything",
          {},
          { stateInit: { universal: stateInit } },
        )
        .catch((e: unknown) => e)
      expect(view).toBeInstanceOf(FunctionCallError)
      expect((view as FunctionCallError).panic).toContain("CodeDoesNotExist")
      const refusal = await near
        .viewExternalCall(accountId, Uint8Array.of(1), {
          stateInit: { universal: stateInit },
        })
        .catch((e: unknown) => e)
      expect((refusal as ExternalCallRefusedError).error).toEqual({
        InvalidTxError: { ContractNotFound: { contract_id: accountId } },
      })
      await expect(
        near.externalCall(accountId, Uint8Array.of(1), { stateInit }),
      ).rejects.toBeInstanceOf(ContractNotDeployedError)
    })

    test("a deterministic state init for another account is invalid", async (ctx) => {
      if (!supported) ctx.skip()
      const root = sandbox.rootAccount.id
      const error = await near
        .view(
          root,
          "anything",
          {},
          { stateInit: { code: { accountId: root } } },
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidStateInitError)
      expect((error as InvalidStateInitError).details).toMatchObject({
        InvalidDeterministicStateInitReceiver: { receiver_id: root },
      })
    })
  })

  test("protocol config reports the external call limits", async (ctx) => {
    if (!supported) ctx.skip()
    const config = await near.getProtocolConfig()
    expect(config.protocol_version).toBeGreaterThanOrEqual(89)
    expect(config.runtime_config.external_calls_config).toMatchObject({
      max_call_size: expect.any(Number),
      max_calls_per_chunk: expect.any(Number),
      chunk_compute_share: [expect.any(Number), expect.any(Number)],
    })
    expect(
      config.runtime_config.wasm_config?.limit_config?.max_gas_burnt_external,
    ).toBeGreaterThan(0)
  })
})
