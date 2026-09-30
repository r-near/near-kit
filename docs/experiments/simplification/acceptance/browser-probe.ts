import * as Effect from "effect/Effect"
import {
  Near,
  InMemoryKeyStore,
  generateKey,
  verifyNep413Signature,
} from "near-kit"
import {
  Near as NativeNear,
  fromClient,
  verifyNep413Signature as verifyNativeSignature,
} from "near-kit/effect"

async function main() {
  const requests: string[] = []
  let pending = false
  let requestSignal: AbortSignal | null | undefined
  const ready = Promise.withResolvers<void>()
  globalThis.fetch = async (_url, init) => {
    if (typeof init?.body !== "string")
      throw Error("RPC request body must be a JSON string")
    const request = JSON.parse(init.body)
    requests.push(request.method)
    if (pending) {
      requestSignal = init?.signal
      ready.resolve()
      return await new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      )
    }
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result:
        request.params?.request_type === "view_access_key"
          ? {
              nonce: 0,
              permission: "FullAccess",
              block_height: 1,
              block_hash: "block",
            }
          : { result: [55], logs: [], block_height: 1, block_hash: "block" },
    })
  }
  const key = generateKey()
  const keyStore = new InMemoryKeyStore()
  await keyStore.add("alice.near", key)
  const near = new Near({
    network: "testnet",
    keyStore,
    defaultSignerId: "alice.near",
  })
  const read = await near.view<number>("counter.near", "read")
  if (read !== 7) throw Error("Promise read failed")
  const nativeRead = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* NativeNear
      return yield* client.view<number>("counter.near", "read")
    }).pipe(Effect.provide(NativeNear.layer({ network: "testnet" }))),
  )
  if (nativeRead !== 7) throw Error("Native layer read failed")
  const params = {
    message: "browser acceptance",
    recipient: "app.near",
    nonce: new Uint8Array(32).fill(7),
  }
  const signed = await near.signMessage(params)
  if (
    !(await verifyNep413Signature(signed, params, {
      near,
      nonceValidation: "none",
    }))
  )
    throw Error("Browser NEP-413 signature verification failed")
  if (
    !(await Effect.runPromise(
      verifyNativeSignature(signed, params, {
        near: fromClient(near),
        nonceValidation: "none",
      }),
    ))
  )
    throw Error("Native browser NEP-413 signature verification failed")
  pending = true
  const controller = new AbortController()
  const run = Effect.runPromiseExit(
    fromClient(near).view("counter.near", "pending"),
    { signal: controller.signal },
  )
  await ready.promise
  controller.abort()
  const exit = await run
  if (exit._tag !== "Failure" || !requestSignal?.aborted)
    throw Error("Browser cancellation failed")
  return {
    ok: true,
    read,
    nativeRead,
    signatureVerified: true,
    nativeSignatureVerified: true,
    transportAborted: true,
    requests: requests.length,
    processPresent: typeof process !== "undefined",
    bufferPresent: typeof Buffer !== "undefined",
  }
}
main()
  .then((result) => {
    document.body.textContent = JSON.stringify(result)
    document.title = "PASS near-kit browser acceptance"
  })
  .catch((error) => {
    document.body.textContent = String(error?.stack ?? error)
    document.title = "FAIL near-kit browser acceptance"
  })
