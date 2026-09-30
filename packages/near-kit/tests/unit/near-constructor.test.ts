/** Constructor dependencies are verified through signing, not private fields. */
import { Effect } from "effect"
import { describe, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import type { BlockView, Signer } from "../../src/core/types.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"
import { testRpcPrograms } from "../helpers/rpc.js"

const message = {
  message: "constructor",
  recipient: "app.near",
  nonce: new Uint8Array(32),
}

describe("Near constructor capability ownership", () => {
  test("default storage is isolated from another configured client", async () => {
    const key = generateKey()
    const configured = new Near({
      keyStore: { "alice.near": key.secretKey },
      defaultSignerId: "alice.near",
    })
    expect((await configured.signMessage(message)).publicKey).toBe(
      key.publicKey.toString(),
    )
    await expect(
      new Near({ defaultSignerId: "alice.near" }).signMessage(message),
    ).rejects.toMatchObject({ code: "NO_KEY_FOUND" })
  })

  test("a caller-owned store supplies keys added after client construction", async () => {
    const store = new InMemoryKeyStore()
    const near = new Near({ keyStore: store, defaultSignerId: "alice.near" })
    const key = generateKey()
    await store.add("alice.near", key)
    expect((await near.signMessage(message)).publicKey).toBe(
      key.publicKey.toString(),
    )
  })

  test("configured signer signs the actual transaction digest once", async () => {
    const key = generateKey()
    const signer = vi.fn<Signer>(async (digest) => key.sign(digest))
    const rpc = {
      ...testRpcPrograms("https://unused.invalid"),
      getBlock: () =>
        Effect.succeed({
          header: { hash: "11111111111111111111111111111111" },
        } as BlockView),
    }
    const near = new Near(
      { keyStore: { "alice.near": key.secretKey }, signer },
      { rpc },
    )
    const tx = await near
      .transaction("alice.near")
      .transfer("bob.near", "1 NEAR")
      .nonce(42n)
      .sign()
    expect(signer).toHaveBeenCalledTimes(1)
    expect(signer.mock.calls[0]?.[0]).toHaveLength(32)
    expect(tx.serialize().length).toBeGreaterThan(64)
  })
})
