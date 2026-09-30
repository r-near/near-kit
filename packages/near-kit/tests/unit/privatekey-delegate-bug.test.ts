import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import { parseKey } from "../../src/utils/key.js"
import { testRpcPrograms } from "../helpers/rpc.js"

const privateKey =
  "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"
const key = parseKey(privateKey)
const accountId = "alice.near"

// This configuration regression belongs at the signing boundary: successfully
// storing a key alone does not prove the delegate receives that key and signer.
describe("configured credentials reach delegate signing", () => {
  test.each([
    [
      "privateKey and defaultSignerId",
      { privateKey, defaultSignerId: accountId },
    ],
    [
      "sandbox root account",
      {
        network: {
          rpcUrl: "http://127.0.0.1:12345",
          networkId: "localnet",
          rootAccount: { id: accountId, secretKey: privateKey },
        },
      },
    ],
    [
      "explicit key record",
      { keyStore: { [accountId]: privateKey }, defaultSignerId: accountId },
    ],
  ] as const)(
    "%s signs the committed delegate payload without RPC",
    async (_source, config) => {
      const request = vi.fn(async () => {
        throw new Error(
          "Delegate with explicit nonce and expiry must not call RPC",
        )
      })
      const near = new Near(config, {
        rpc: testRpcPrograms("https://unused.invalid", request),
      })
      const result = await near
        .transaction(accountId)
        .transfer("bob.near", "1 NEAR")
        .delegate({ nonce: 42n, maxBlockHeight: 200n, payloadFormat: "bytes" })
      const delegate = result.signedDelegateAction.signedDelegate.delegateAction
      expect(request).not.toHaveBeenCalled()
      expect(delegate.senderId).toBe(accountId)
      expect(delegate.receiverId).toBe("bob.near")
      expect(delegate.publicKey).toEqual({
        ed25519Key: { data: Array.from(key.publicKey.data) },
      })
      // Captured from the pre-migration Promise implementation at 2565579. The
      // independent commitment includes the configured key, signer and signature.
      expect(Buffer.from(sha256(result.payload)).toString("hex")).toBe(
        "9a2ff457d85eaf9cd6679b017ef62cff32e2207d538b06a26200fea2720b65d4",
      )
    },
  )
})
