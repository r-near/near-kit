import type { FinalExecutionOutcome } from "near-kit"

/** Finite application work. The examples never choose a live network or keys. */
export interface WorkflowInput {
  readonly accounts: readonly string[]
  readonly receiverId: string
  readonly readCount: number
  readonly transfersPerAccount: number
  readonly pageSize: number
  readonly concurrency: number
}

export interface WorkflowResult {
  readonly state: readonly {
    readonly key: string
    readonly value: string
    readonly accountId: string
  }[]
  readonly reads: readonly unknown[]
  readonly transactions: readonly FinalExecutionOutcome[]
}

export const workflowItems = (input: WorkflowInput) => {
  if (
    input.accounts.length === 0 ||
    !Number.isInteger(input.concurrency) ||
    input.concurrency < 1
  ) {
    throw new Error("Provide signing accounts and a positive concurrency limit")
  }
  return {
    reads: Array.from({ length: input.readCount }, (_, index) => ({
      accountId: input.accounts[index % input.accounts.length] ?? "",
      index,
    })),
    transfers: Array.from(
      { length: input.accounts.length * input.transfersPerAccount },
      (_, index) => input.accounts[index % input.accounts.length] ?? "",
    ),
  }
}
