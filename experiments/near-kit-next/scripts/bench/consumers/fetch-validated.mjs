// Benchmark reference only: bounded wire/body validation, not a replacement SDK.
import {
  count,
  four,
  metadata,
  projectAccount,
  wireReference,
} from "./common.mjs"
export const supportsCancellation = true
const invalid = () => {
  throw new Error("Invalid response")
}
const text = (v) => typeof v === "string" && v.length > 0
const natural = (v) => Number.isSafeInteger(v) && v >= 0
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function checkMetadata(wire, at) {
  if (
    !record(wire) ||
    !text(wire.block_hash) ||
    !natural(wire.block_height) ||
    (at !== "final" && wire.block_hash !== at)
  )
    invalid()
}
function decimal(value) {
  const max = "340282366920938463463374607431768211455"
  if (
    !text(value) ||
    value.length > max.length ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    (value.length === max.length && value > max)
  )
    invalid()
}
export function make(url) {
  let nextId = 0
  const query = async (params, signal) => {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.throwIfAborted()
    signal?.addEventListener("abort", abort, { once: true })
    let reader
    try {
      const id = ++nextId
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "query", params }),
        signal: controller.signal,
        redirect: "error",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) invalid()
      reader = response.body.getReader()
      const chunks = []
      let size = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value.byteLength > 2 * 1024 * 1024 - size) invalid()
        if (value.byteLength) {
          chunks.push(value.slice())
          size += value.byteLength
        }
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const part of chunks) {
        bytes.set(part, offset)
        offset += part.byteLength
      }
      const envelope = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      )
      if (
        !record(envelope) ||
        envelope.jsonrpc !== "2.0" ||
        envelope.id !== id ||
        Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error")
      )
        invalid()
      if (Object.hasOwn(envelope, "error")) {
        const error = envelope.error
        if (
          !record(error) ||
          !Number.isSafeInteger(error.code) ||
          typeof error.message !== "string"
        )
          invalid()
        if (
          error.name === "HANDLER_ERROR" &&
          error.cause?.name === "UNKNOWN_ACCOUNT"
        ) {
          checkMetadata(error.cause.info, "final")
          if (error.cause.info.requested_account_id !== params.account_id)
            invalid()
        }
        throw new Error("RPC error")
      }
      return envelope.result
    } finally {
      controller.abort()
      signal?.removeEventListener("abort", abort)
      if (reader) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
  }
  const call = async (id, at, signal) => {
    const wire = await query(
      {
        request_type: "call_function",
        account_id: id,
        method_name: "count",
        args_base64: "e30=",
        ...wireReference(at),
      },
      signal,
    )
    checkMetadata(wire, at)
    if (
      !Array.isArray(wire.logs) ||
      !wire.logs.every((v) => typeof v === "string") ||
      !Array.isArray(wire.result) ||
      !wire.result.every((v) => natural(v) && v <= 255) ||
      Object.hasOwn(wire, "error")
    )
      invalid()
    return {
      value: new Uint8Array(wire.result),
      logs: wire.logs,
      ...metadata(wire),
    }
  }
  const api = {
    account: async (id, at = "final", signal) => {
      const wire = await query(
        { request_type: "view_account", account_id: id, ...wireReference(at) },
        signal,
      )
      checkMetadata(wire, at)
      decimal(wire.amount)
      decimal(wire.locked)
      if (!natural(wire.storage_usage) || !text(wire.code_hash)) invalid()
      for (const field of [
        "global_contract_hash",
        "global_contract_account_id",
      ])
        if (wire[field] != null && !text(wire[field])) invalid()
      return projectAccount(wire)
    },
    view: async (id, at = "final", signal) => {
      const result = await call(id, at, signal)
      return {
        ...result,
        value: count(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(result.value),
          ),
        ),
      }
    },
    bytes: (id, at = "final", signal) => call(id, at, signal),
    four: (hash) => four(api, hash),
  }
  return api
}
