import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Near } from "near-kit"
import { Client, type Near as NativeNear } from "near-kit/effect"
import {
  workflowItems,
  type WorkflowInput,
  type WorkflowResult,
} from "./workflow-common.js"

/** The ordinary Promise API performs the same finite work as nativeWorkflow. */
export async function promiseWorkflow(
  near: Near,
  input: WorkflowInput,
): Promise<WorkflowResult> {
  const items = workflowItems(input)
  const state = (
    await bounded(input.accounts, input.concurrency, async (accountId) => {
      const values: WorkflowResult["state"][number][] = []
      for await (const item of near.viewStateAll(accountId, {
        limit: input.pageSize,
      })) {
        values.push({ ...item, accountId })
      }
      return values
    })
  ).flat()
  const reads = await bounded(
    items.reads,
    input.concurrency,
    ({ accountId, index }) => near.view(accountId, "get_status", { index }),
  )
  const transactions = await bounded(
    items.transfers,
    input.concurrency,
    (signerId) =>
      near
        .transaction(signerId)
        .transfer(input.receiverId, "1 yocto")
        .send({ waitUntil: "NONE" }),
  )
  return { state, reads, transactions }
}

/** One runtime belongs to the application, and its client is acquired once. */
export async function runPromiseWorkflow<E>(
  layer: Layer.Layer<Client | NativeNear, E>,
  input: WorkflowInput,
): Promise<WorkflowResult> {
  const runtime = ManagedRuntime.make(layer)
  try {
    const owner = await runtime.runPromise(Client)
    return await promiseWorkflow(Near.fromClient(owner), input)
  } finally {
    await runtime.dispose()
  }
}

async function bounded<A, B>(
  items: readonly A[],
  concurrency: number,
  operation: (item: A) => Promise<B>,
): Promise<B[]> {
  let next = 0
  let failed = false
  const results: B[] = []
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failed) {
        const index = next++
        if (index >= items.length) return
        const item = items[index]
        if (item === undefined) return
        try {
          results[index] = await operation(item)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )
  // The public Promise methods have no AbortSignal option. Wait for started
  // work before disposal; native fibers can interrupt siblings directly.
  for (const worker of workers) {
    if (worker.status === "rejected") throw worker.reason
  }
  return results
}
