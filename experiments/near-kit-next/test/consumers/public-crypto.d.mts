import type { Nep413Proof } from "@near-kit/next/nep413"

export function publicCryptoChecks(fixture: {
  readonly vectors: ReadonlyArray<{
    readonly id: string
    readonly payload: {
      readonly message: string
      readonly recipient: string
      readonly nonceHex: string
      readonly callbackUrl?: string | undefined
    }
    readonly proof: Nep413Proof
    readonly negativeProofs?:
      | ReadonlyArray<{
          readonly id: string
          readonly proof: Nep413Proof
        }>
      | undefined
  }>
}): {
  address: boolean
  verified: number
  wrongMessageRejected: boolean
  detachedRejected: boolean
}
