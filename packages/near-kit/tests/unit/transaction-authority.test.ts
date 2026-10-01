import { base64 } from "@scure/base"
import { Deferred, Effect, Fiber } from "effect"
import { expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import type { KeyPair } from "../../src/core/types.js"
import {
  fetchTransport,
  makeRpcPrograms,
} from "../../src/core/rpc/rpc-program.js"
import { makeNonceReservation } from "../../src/effect/nonce.js"
import { generateKey } from "../../src/utils/key.js"
import { inspectSignedTransaction } from "../../../../tests/browser/wire-oracle.js"
import { testBlock } from "../helpers/rpc.js"

test.each(
  (
    [
      { api: "public", strict: false },
      { api: "public", strict: true },
      { api: "native", strict: false },
      { api: "native", strict: true },
    ] as const
  ).flatMap((mode) =>
    (["provider", "bytes"] as const).map((change) => ({ ...mode, change })),
  ),
)(
  "$api captures $change authority before the submission wait (strict=$strict)",
  async ({ api, strict, change }) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const a = generateKey()
        const b = generateKey()
        const expectedPublicKey = a.publicKey.toString()
        let current = a
        const provided: KeyPair = {
          get publicKey() {
            return current.publicKey
          },
          get secretKey() {
            return current.secretKey
          },
          get sign() {
            return current.sign.bind(current)
          },
        }
        const nonces = yield* makeNonceReservation
        const heldA = yield* Deferred.make<void>()
        const heldB = yield* Deferred.make<void>()
        const releaseA = yield* Deferred.make<void>()
        const releaseB = yield* Deferred.make<void>()
        const waiting = yield* Deferred.make<string>()
        const hold = (
          key: KeyPair,
          entered: Deferred.Deferred<void>,
          release: Deferred.Deferred<void>,
        ) =>
          nonces.withSubmission(
            "alice.near",
            key.publicKey.toString(),
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            ),
          )
        yield* hold(a, heldA, releaseA).pipe(Effect.forkScoped)
        yield* hold(b, heldB, releaseB).pipe(Effect.forkScoped)
        yield* Deferred.await(heldA)
        yield* Deferred.await(heldB)
        const wires: Uint8Array[] = []
        const rpc = yield* makeRpcPrograms(
          { url: "https://unused.invalid", retry: { maxRetries: 0 } },
          fetchTransport(async (_url, init) => {
            if (typeof init?.body !== "string")
              throw new Error("Expected JSON request")
            const request: {
              id: number
              method: string
              params: { signed_tx_base64?: string }
            } = JSON.parse(init.body)
            let result: unknown
            if (request.method === "block") result = testBlock
            else if (request.method === "query")
              result = {
                nonce: 1,
                permission: "FullAccess",
                block_height: 1,
                block_hash: "11111111111111111111111111111111",
              }
            else if (
              request.method === "send_tx" &&
              request.params.signed_tx_base64
            ) {
              wires.push(base64.decode(request.params.signed_tx_base64))
              result = { final_execution_status: "NONE" }
            } else throw new Error(`Unexpected RPC ${request.method}`)
            return Response.json({ jsonrpc: "2.0", id: request.id, result })
          }),
        )
        const near = new Near(
          {
            keyStore: {
              get: async () => provided,
              add: async () => {},
              remove: async () => {},
              list: async () => [],
            },
          },
          {
            rpc,
            nonceReservation: {
              ...nonces,
              withSubmission: (account, key, operation) =>
                Deferred.succeed(waiting, key).pipe(
                  Effect.andThen(
                    nonces.withSubmission(account, key, operation),
                  ),
                ),
            },
          },
        )
        const send =
          api === "native"
            ? near.effects.transactions.send(
                {
                  signerId: "alice.near",
                  receiverId: "bob.near",
                  actions: [{ transfer: { deposit: 1n } }],
                  strictNonce: strict,
                },
                { waitUntil: "NONE" },
              )
            : Effect.promise(() =>
                near
                  .transaction("alice.near")
                  .transfer("bob.near", 1n)
                  .strictNonceMode(strict)
                  .send({ waitUntil: "NONE" }),
              )
        const pending = yield* send.pipe(Effect.forkScoped)
        // Observe the actual allocator boundary before changing the external provider.
        expect(yield* Deferred.await(waiting)).toBe(expectedPublicKey)
        if (change === "provider") current = b
        else a.publicKey.data.set(b.publicKey.data)
        yield* Deferred.succeed(releaseA, undefined)
        yield* Fiber.join(pending)
        expect(wires).toHaveLength(1)
        const wire = wires[0]
        if (!wire) throw new Error("Expected one submission")
        const inspected = inspectSignedTransaction(base64.encode(wire))
        expect(inspected.signatureValid).toBe(true)
        expect(inspected.publicKey).toBe(expectedPublicKey)
        expect(inspected.version).toBe(strict ? 1 : 0)
        // B remains held throughout: a changed external object must not change lanes.
        yield* Deferred.succeed(releaseB, undefined)
      }).pipe(Effect.scoped),
    )
  },
)
