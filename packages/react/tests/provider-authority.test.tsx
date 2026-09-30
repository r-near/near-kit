import { renderHook } from "@testing-library/react"
import {
  generateKey,
  type KeyStore,
  type NearConfig,
  type SignMessageParams,
  type WalletConnection,
} from "near-kit"
import type { ReactNode } from "react"
import { describe, expect, test } from "vitest"
import { NearProvider, useNear } from "../src/provider.js"

describe("NearProvider signing authority changes", () => {
  test.each(["keyStore", "wallet"] as const)(
    "uses the replacement %s for the next signing operation",
    async (authority) => {
      const original = generateKey()
      const replacement = generateKey()
      const calls: [number, number] = [0, 0]
      const configFor = (index: 0 | 1): NearConfig => {
        const key = index === 0 ? original : replacement
        const keyStore: KeyStore = {
          get: async () => {
            calls[index]++
            return key
          },
          add: async () => {},
          remove: async () => {},
          list: async () => ["alice.near"],
        }
        const wallet: WalletConnection = {
          getAccounts: async () => [{ accountId: "alice.near" }],
          signAndSendTransaction: async () => {
            throw new Error("Signing a message must never submit a transaction")
          },
          signMessage: async (params) => {
            calls[index]++
            if (!key.signNep413Message) throw new Error("Expected Ed25519 key")
            return key.signNep413Message("alice.near", params)
          },
        }
        return {
          network: "testnet",
          defaultSignerId: "alice.near",
          ...(authority === "wallet" ? { wallet } : { keyStore }),
        }
      }
      let config = configFor(0)
      const wrapper = ({ children }: { children: ReactNode }) => (
        <NearProvider config={config}>{children}</NearProvider>
      )
      const hook = renderHook(() => useNear(), { wrapper })
      const params: SignMessageParams = {
        message: "login",
        recipient: "app.near",
        nonce: new Uint8Array(32),
      }
      expect((await hook.result.current.signMessage(params)).publicKey).toBe(
        original.publicKey.toString(),
      )
      config = configFor(1)
      hook.rerender()
      const signed = await hook.result.current.signMessage(params)
      hook.unmount()
      expect(signed.publicKey).toBe(replacement.publicKey.toString())
      expect(calls).toEqual([1, 1])
    },
  )
})
