import { z } from "zod"
import { AccountIdSchema, AmountSchema } from "near-kit/schemas"

const TransferForm = z
  .object({
    senderId: AccountIdSchema,
    amount: AmountSchema,
  })
  .extend({ memo: z.string().optional() })

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Must<T extends true> = T

export type CompositionInput = Must<
  Equal<
    z.input<typeof TransferForm>,
    {
      senderId: string
      amount: string | bigint
      memo?: string | undefined
    }
  >
>
export type CompositionOutput = Must<
  Equal<
    z.output<typeof TransferForm>,
    {
      senderId: string
      amount: string
      memo?: string | undefined
    }
  >
>
