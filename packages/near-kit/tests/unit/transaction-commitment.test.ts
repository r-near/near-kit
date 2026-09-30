import { sha256 } from "@noble/hashes/sha2.js"
import { ed25519 } from "@noble/curves/ed25519.js"
import { base58 } from "@scure/base"
import { describe, expect, test, vi } from "vitest"
import { Effect } from "effect"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { NetworkError } from "../../src/errors/index.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { generateKey, parseKey } from "../../src/utils/key.js"
import { testRpcClient, testRpcPrograms } from "../helpers/rpc.js"

// Deterministic, self-consistent Ed25519 fixture; verification is independent of
// the SDK's parse/sign/serialization path rather than a captured byte-only key.
const SEED = new Uint8Array(32).fill(7)
const PRIVATE_KEY = `ed25519:${base58.encode(new Uint8Array([...SEED, ...ed25519.getPublicKey(SEED)]))}`

function setup(strict = false) {
  const key = parseKey(PRIVATE_KEY)
  const rpc = testRpcClient("https://unused.invalid")
  rpc.getBlock = async () =>
    ({ header: { hash: "11111111111111111111111111111111" } }) as never
  const sent: Uint8Array[] = []
  rpc.sendTransaction = async (bytes) => {
    sent.push(bytes.slice())
    return { final_execution_status: "NONE" } as never
  }
  const builder = new TransactionBuilder(
    "alice.near",
    rpc,
    new InMemoryKeyStore({ "alice.near": PRIVATE_KEY }),
  )
    .nonce(42n)
    .strictNonceMode(strict)
  return { key, rpc, builder, sent }
}
function expectCommitment(
  wire: Uint8Array,
  hash: string | null,
  publicKey: Uint8Array,
) {
  // Ed25519 signatures occupy the final discriminator + 64 bytes in both wire versions.
  const digest = sha256(wire.slice(0, -65))
  expect(base58.encode(digest)).toBe(hash)
  expect(ed25519.verify(wire.slice(-64), digest, publicKey)).toBe(true)
}

describe.each([false, true])(
  "transaction commitment ownership (strict V1=%s)",
  (strict) => {
    test("a pending signature cannot restore the cache after a fluent edit", async () => {
      const { builder, key } = setup(strict)
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      builder.transfer("bob.near", "1 NEAR").signWith(async (digest) => {
        started.resolve()
        await release.promise
        return key.sign(digest)
      })
      const pending = builder.sign()
      await started.promise
      builder.transfer("bob.near", "2 NEAR")
      release.resolve()
      await pending
      expect(builder.getHash()).toBeNull()
      expect(() => builder.serialize()).toThrow("must be signed")
      await builder.sign()
      expectCommitment(
        builder.serialize(),
        builder.getHash(),
        key.publicKey.data,
      )
    })

    test.each(["arguments", "code"] as const)(
      "caller-owned %s bytes cannot change a pending signed commitment",
      async (kind) => {
        const { builder, key, sent } = setup(strict)
        const bytes = new Uint8Array([1, 2, 3])
        if (kind === "arguments")
          builder.functionCall("contract.near", "write", bytes)
        else builder.deployContract("contract.near", bytes)
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const signer = vi.fn(async (digest: Uint8Array) => {
          started.resolve()
          await release.promise
          return key.sign(digest)
        })
        builder.signWith(signer)
        const pending = builder.sign()
        await started.promise
        bytes.fill(99)
        release.resolve()
        await pending
        const expected = builder.serialize()
        expectCommitment(expected, builder.getHash(), key.publicKey.data)
        expected.fill(77)
        const committed = builder.serialize()
        expectCommitment(committed, builder.getHash(), key.publicKey.data)
        await builder.sign()
        expect(signer).toHaveBeenCalledTimes(1)
        const result = await builder.send({ waitUntil: "NONE" })
        expect(sent).toEqual([committed])
        expect(result.transaction?.hash).toBe(builder.getHash())
      },
    )

    test("a signer cannot alter the captured digest or returned signature bytes", async () => {
      const { builder, key } = setup(strict)
      let returnedSignature: ReturnType<typeof key.sign> | undefined
      builder.transfer("bob.near", "1 NEAR").signWith(async (digest) => {
        returnedSignature = key.sign(digest)
        digest.fill(9)
        return returnedSignature
      })
      await builder.sign()
      returnedSignature?.data.fill(8)
      expectCommitment(
        builder.serialize(),
        builder.getHash(),
        key.publicKey.data,
      )
    })
  },
)

test("an unsigned build result and nested permission inputs do not alias the signing plan", async () => {
  const { builder, key } = setup()
  const methodNames = ["allowed"]
  builder.addKey(key.publicKey.toString(), {
    type: "functionCall",
    receiverId: "contract.near",
    methodNames,
  })
  methodNames.push("unrequested")
  const unsigned = await builder.build()
  expect(unsigned.actions).toMatchObject([
    {
      addKey: {
        accessKey: {
          permission: { functionCall: { methodNames: ["allowed"] } },
        },
      },
    },
  ])
  unsigned.actions.push({ transfer: { deposit: 100n } })
  unsigned.publicKey.data.fill(0)
  await builder.sign()
  expectCommitment(builder.serialize(), builder.getHash(), key.publicKey.data)
  expect((await builder.build()).actions).toHaveLength(1)
})

test("build returns unsigned input without prematurely enforcing Borsh ranges", async () => {
  const { builder } = setup()
  builder.transfer("bob.near", 1n << 128n)
  expect((await builder.build()).actions).toEqual([
    { transfer: { deposit: 1n << 128n } },
  ])
  await expect(builder.sign()).rejects.toThrow("Value out of range for u128")
})

test("a later signature remains cached when an older plan finishes last", async () => {
  const { builder, key } = setup()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let count = 0
  builder.transfer("bob.near", "1 NEAR").signWith(async (digest) => {
    if (++count === 1) {
      started.resolve()
      await release.promise
    }
    return key.sign(digest)
  })
  const older = builder.sign()
  await started.promise
  builder.nonce(43n)
  await builder.sign()
  const latest = builder.serialize()
  const hash = builder.getHash()
  release.resolve()
  await older
  expect(builder.serialize()).toEqual(latest)
  expect(builder.getHash()).toBe(hash)
  expectCommitment(latest, hash, key.publicKey.data)
})

test("caller replay after nonce rejection retains the rotating key and exact signed bytes", async () => {
  const keys = [generateKey(), generateKey()]
  let gets = 0
  const rpc = setup().rpc
  rpc.getTransactionStatus = async () => {
    throw new Error("not visible")
  }
  const publicKeys: string[] = []
  rpc.getAccessKey = async (_id, publicKey) => {
    publicKeys.push(publicKey)
    return { nonce: 1 } as never
  }
  const sent: Uint8Array[] = []
  let requests = 0
  const sender = testRpcPrograms(
    "https://rpc.invalid",
    async (_url, init) => {
      if (typeof init.body !== "string") throw new Error("Expected RPC body")
      const { id } = JSON.parse(init.body)
      requests++
      return Response.json(
        requests === 1
          ? {
              jsonrpc: "2.0",
              id,
              error: {
                name: "HANDLER_ERROR",
                code: -32000,
                message: "nonce rejected",
                cause: { name: "INVALID_TRANSACTION", info: {} },
                data: {
                  TxExecutionError: {
                    InvalidTxError: {
                      InvalidNonce: { tx_nonce: 2, ak_nonce: 10 },
                    },
                  },
                },
              },
            }
          : {
              jsonrpc: "2.0",
              id,
              result: { final_execution_status: "NONE" },
            },
      )
    },
    undefined,
    { maxRetries: 0 },
  )
  rpc.sendTransaction = async (bytes, waitUntil) => {
    sent.push(bytes.slice())
    return Effect.runPromise(sender.sendTransaction(bytes, waitUntil))
  }
  const store = {
    get: async () => keys[gets++ % keys.length] ?? null,
    add: async () => {},
    remove: async () => {},
    list: async () => [],
  }
  const builder = new TransactionBuilder("rotating.near", rpc, store).transfer(
    "bob.near",
    "1 NEAR",
  )
  await expect(builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
    retryable: false,
  })
  await builder.send({ waitUntil: "NONE" })
  expect(gets).toBe(1)
  expect(sent).toHaveLength(2)
  expect(sent[0]).toEqual(sent[1])
  expect(new Set(publicKeys).size).toBe(1)
  const key = keys[0]
  if (!key) throw new Error("fixture key missing")
  for (const wire of sent)
    expect(
      ed25519.verify(
        wire.slice(-64),
        sha256(wire.slice(0, -65)),
        key.publicKey.data,
      ),
    ).toBe(true)
})

test("an ambiguous broadcast failure retains the exact signed bytes for caller retry", async () => {
  const { builder, rpc } = setup()
  builder.transfer("bob.near", "1 NEAR")
  const sent: Uint8Array[] = []
  const loss = new NetworkError("submission result lost")
  rpc.getTransactionStatus = async () => {
    throw new Error("not yet visible")
  }
  rpc.sendTransaction = async (bytes) => {
    sent.push(bytes.slice())
    if (sent.length === 1) throw loss
    return { final_execution_status: "NONE" } as never
  }
  await expect(builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
    retryable: false,
    data: { cause: loss },
  })
  expect(builder.getHash()).not.toBeNull()
  await builder.send({ waitUntil: "NONE" })
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
})

test.each(["42", true, null, undefined])(
  "public nonce rejects nonnumeric JavaScript input %s",
  (value) => {
    const { builder } = setup()
    expect(() => builder.nonce(value as never)).toThrow(
      "Transaction nonce must be a safe integer or a bigint",
    )
  },
)

test("failed shared signing is cleared so a later acquisition can succeed", async () => {
  const { key, builder } = setup()
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const failure = new Error("hardware not ready")
  let calls = 0
  builder.transfer("bob.near", "1 yocto").signWith(async (digest) => {
    const attempt = ++calls
    started.resolve()
    await gate.promise
    if (attempt === 1) throw failure
    return key.sign(digest)
  })
  const attempts = Promise.allSettled([builder.sign(), builder.sign()])
  await started.promise
  gate.resolve()
  expect(await attempts).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ])
  expect(calls).toBe(1)
  expect(builder.getHash()).toBeNull()
  await builder.sign()
  expect(calls).toBe(2)
  expectCommitment(builder.serialize(), builder.getHash(), key.publicKey.data)
})

test.each([false, true])(
  "an old signing completion cannot invalidate its replacement (failure=%s)",
  async (failOld) => {
    const { key, builder } = setup()
    const oldGate = Promise.withResolvers<void>()
    const oldStarted = Promise.withResolvers<void>()
    const newGate = Promise.withResolvers<void>()
    const newStarted = Promise.withResolvers<void>()
    const oldError = new Error("superseded signer failure")
    let newCalls = 0
    builder.transfer("bob.near", "1 yocto").signWith(async (digest) => {
      oldStarted.resolve()
      await oldGate.promise
      if (failOld) throw oldError
      return key.sign(digest)
    })
    const old = builder.sign().then(
      () => undefined,
      (error: unknown) => error,
    )
    await oldStarted.promise
    builder.signWith(async (digest) => {
      newCalls++
      newStarted.resolve()
      await newGate.promise
      return key.sign(digest)
    })
    const replacement = builder.sign()
    await newStarted.promise
    oldGate.resolve()
    expect(await old).toBe(failOld ? oldError : undefined)
    expect(builder.getHash()).toBeNull()
    const overlapping = builder.sign()
    newGate.resolve()
    await Promise.all([replacement, overlapping])
    expect(newCalls).toBe(1)
    expectCommitment(builder.serialize(), builder.getHash(), key.publicKey.data)
  },
)
