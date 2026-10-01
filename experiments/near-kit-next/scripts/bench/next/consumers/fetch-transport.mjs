// Direct references. Bounded mode checks the shared transport boundary only;
// projection still lacks the candidate's general protocol schemas and typed errors.
export function transport(url, bounded = false) {
  let nextId = 0
  return async (method, params, signal) => {
    signal?.throwIfAborted()
    const controller = new AbortController(),
      abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    let reader
    try {
      const id = ++nextId
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
        redirect: "error",
      })
      if (!response.ok) throw Error(`HTTP ${response.status}`)
      let body
      if (bounded) {
        reader = response.body.getReader()
        const chunks = []
        let size = 0
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value.byteLength > 2 * 1024 * 1024 - size)
            throw Error("Body limit")
          if (value.byteLength) {
            chunks.push(value.slice())
            size += value.byteLength
          }
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        )
        if (
          body?.jsonrpc !== "2.0" ||
          body.id !== id ||
          Object.hasOwn(body, "result") === Object.hasOwn(body, "error")
        )
          throw Error("Invalid envelope")
      } else body = await response.json()
      if (body.error) throw Error("RPC error")
      return body.result
    } finally {
      controller.abort()
      signal?.removeEventListener("abort", abort)
      if (reader) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
  }
}
