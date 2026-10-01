/** Full official RPC inspection without pretending to type every wire field.
 * Streams original UTF-8 response bytes to stdout, preserving numeric tokens.
 * HTTP 200 can contain a JSON-RPC error. This CLI does not decode that envelope;
 * truncated output after a failure is partial. Redirects are rejected.
 */
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseHash } from "@near-kit/next/data"

export function rawReadRequest(command: string, hash?: string) {
  if (command === "genesis" && hash === undefined)
    return { method: "genesis_config", params: [] }
  if (command === "config" && hash === undefined)
    return {
      method: "EXPERIMENTAL_protocol_config",
      params: { finality: "final" },
    }
  if ((command === "block" || command === "chunk") && hash !== undefined) {
    parseHash(hash)
    return {
      method: command,
      params: command === "block" ? { block_id: hash } : { chunk_id: hash },
    }
  }
  throw new TypeError("Choose genesis, config, block HASH or chunk HASH")
}
export async function main(args: readonly string[]) {
  const [url, command, hash] = args
  if (!url || !command || args.length > 3) {
    console.error(
      "Usage: raw-inspection.ts RPC_URL {genesis|config|block HASH|chunk HASH}",
    )
    return 2
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(15000),
  ])
  try {
    const endpoint = new URL(url)
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new TypeError(
        "Expected an HTTP(S) endpoint without embedded credentials",
      )
    const request = rawReadRequest(command, hash)
    signal.throwIfAborted()
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "inspect", ...request }),
      signal,
    })
    if (!response.ok || response.body === null)
      throw new Error("HTTP read failed")
    let bytes = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > 16 * 1024 * 1024)
          throw new RangeError("Inspection body exceeds 16 MiB")
        // Await the write callback for backpressure without closing caller stdout.
        await new Promise<void>((resolve, reject) =>
          process.stdout.write(next.value, (error) =>
            error ? reject(error) : resolve(),
          ),
        )
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    return 0
  } catch {
    console.error(
      "Raw read failed or interrupted; any stdout output is partial",
    )
    return controller.signal.aborted ? 130 : 1
  } finally {
    process.removeListener("SIGINT", stop)
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2))
