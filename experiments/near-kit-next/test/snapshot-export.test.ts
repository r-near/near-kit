import { spawnSync } from "node:child_process"
import { promises as fs } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Near from "@near-kit/next"
import { Cause, Effect, Exit } from "effect"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { exportSnapshot, main } from "../examples/snapshot-export.js"
import type { WireRequest } from "./fixtures.js"
import { accountWire, HASH, harness, OTHER_HASH } from "./fixtures.js"

// Application lifetime/encoding evidence with mocked read-only RPC responses.
// These tests neither initialize state nor submit protocol writes.
const accountId = "fixture.testnet"
const client = Near.make({ url: "https://example.test/rpc" })
const metadata = { block_hash: HASH, block_height: 123 }
const amount = "340282366920938463463374607431768211455"
let directory: string
let output: string
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "near-snapshot-"))
  output = join(directory, "snapshot.ndjson")
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

function fixture(request: WireRequest): unknown {
  if (request.method === "block")
    return {
      header: {
        hash: HASH,
        prev_hash: OTHER_HASH,
        height: 123,
        timestamp_nanosec: "18446744073709551615",
        gas_price: amount,
      },
    }
  if (request.method === "gas_price") return { gas_price: amount }
  switch (request.params.request_type) {
    case "view_account":
      return { ...accountWire, code_hash: OTHER_HASH, amount }
    case "view_access_key_list":
      return {
        ...metadata,
        keys: [
          {
            public_key: `ed25519:${HASH}`,
            access_key: {
              nonce: 42,
              permission: {
                FunctionCall: {
                  allowance: amount,
                  receiver_id: "contract.testnet",
                  method_names: ["read"],
                },
              },
            },
          },
        ],
      }
    case "view_code":
      return { ...metadata, hash: OTHER_HASH, code_base64: "AGFzbQ==" }
    case "view_state":
      return Object.hasOwn(request.params, "after_key_base64")
        ? { ...metadata, values: [{ key: "/w==", value: "AP8B" }] }
        : {
            ...metadata,
            values: [{ key: "w6k=", value: "AA==" }],
            last_key: "w6k=",
          }
    default:
      throw new Error("Unexpected request in read-only fixture")
  }
}
function codeRejection(
  request: WireRequest,
  name: string,
  contract = accountId,
) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32000,
        message: "not an application diagnostic",
        name: "HANDLER_ERROR",
        cause: { name, info: { ...metadata, contract_account_id: contract } },
      },
    }),
  )
}
async function records(path: string) {
  return (await fs.readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}
const program = () => exportSnapshot(client, accountId, output)
const stateRequests = (h: ReturnType<typeof harness>) =>
  h.requests.filter(
    ({ request }) => request.params.request_type === "view_state",
  )
function trackFile(setup: (file: FileHandle) => void = () => {}) {
  const open = fs.open.bind(fs)
  const files: FileHandle[] = []
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const file = await open(...args)
    files.push(file)
    setup(file)
    return file
  })
  return files
}

it("publishes useful complete output after natural traversal, pinning every read to one hash", async () => {
  const files = trackFile()
  const h = harness(fixture)
  const saved = program()
  expect(h.requests).toHaveLength(0)
  expect(files).toHaveLength(0)
  const summary = await Effect.runPromise(h.provide(saved))
  expect(summary).toEqual({
    outputPath: output,
    blockHash: HASH,
    pages: 2n,
    entries: 2n,
  })
  expect(files).toHaveLength(1)
  expect(files[0]?.fd).toBe(-1)
  await expect(fs.stat(`${output}.partial`)).rejects.toMatchObject({
    code: "ENOENT",
  })
  const rows = await records(output)
  expect(rows.map((row) => row.type)).toEqual([
    "begin",
    "header",
    "state-page",
    "state-page",
    "end",
  ])
  expect(rows[0]).toEqual({
    type: "begin",
    format: "near-kit-snapshot-v1",
    accountId,
    bigints: "decimal-string",
    bytes: "tagged-base64",
  })
  expect(rows[1]).toMatchObject({
    block: {
      blockHash: HASH,
      blockHeight: "123",
      timestampNanoseconds: "18446744073709551615",
      gasPrice: amount,
    },
    account: { amount, locked: "0", storageUsage: "410", codeHash: OTHER_HASH },
    keys: {
      keys: [
        {
          accessKey: {
            nonce: "42",
            permission: { kind: "FunctionCall", allowance: amount },
          },
        },
      ],
    },
    localCode: {
      status: "available",
      code: {
        bytes: { encoding: "base64", data: "AGFzbQ==" },
        codeHash: OTHER_HASH,
      },
    },
    gasPrice: amount,
  })
  expect(rows[1].keys.keys[0].publicKey).toMatchObject({
    kind: "ed25519",
    data: { encoding: "base64" },
  })
  expect(rows[2].page.entries).toEqual([
    {
      key: { encoding: "base64", data: "w6k=" },
      value: { encoding: "base64", data: "AA==" },
    },
  ])
  expect(rows[3].page.entries).toEqual([
    {
      key: { encoding: "base64", data: "/w==" },
      value: { encoding: "base64", data: "AP8B" },
    },
  ])
  expect(rows[4]).toEqual({
    type: "end",
    blockHash: HASH,
    pages: "2",
    entries: "2",
  })
  expect(h.requests).toHaveLength(7)
  expect(h.requests[0]?.request).toMatchObject({
    method: "block",
    params: { finality: "final" },
  })
  for (const { request } of h.requests.slice(1)) {
    if (request.method === "gas_price") expect(request.params).toEqual([HASH])
    else {
      expect(request.method).toBe("query")
      expect([
        "view_account",
        "view_access_key_list",
        "view_code",
        "view_state",
      ]).toContain(request.params.request_type)
      expect(request.params).toMatchObject({
        account_id: accountId,
        block_id: HASH,
      })
      expect(request.params).not.toHaveProperty("finality")
    }
  }
  expect(stateRequests(h).map(({ request }) => request.params)).toEqual([
    {
      request_type: "view_state",
      account_id: accountId,
      block_id: HASH,
      prefix_base64: "",
      limit: 100,
    },
    {
      request_type: "view_state",
      account_id: accountId,
      block_id: HASH,
      prefix_base64: "",
      limit: 100,
      after_key_base64: "w6k=",
    },
  ])
})

it("naturally completes an empty account-state stream", async () => {
  const h = harness((request) =>
    request.params.request_type === "view_state"
      ? { ...metadata, values: [] }
      : fixture(request),
  )
  const summary = await Effect.runPromise(h.provide(program()))
  expect(summary).toMatchObject({ pages: 1n, entries: 0n })
  expect((await records(output)).at(-1)).toMatchObject({
    type: "end",
    pages: "1",
    entries: "0",
  })
  expect(stateRequests(h)).toHaveLength(1)
})

it("records typed local CodeUnavailable and still exports an account's state", async () => {
  const h = harness((request) =>
    request.params.request_type === "view_code"
      ? codeRejection(request, "NO_CONTRACT_CODE")
      : fixture(request),
  )
  await Effect.runPromise(h.provide(program()))
  expect((await records(output))[1].localCode).toEqual({
    status: "unavailable",
    reason: "CodeUnavailable",
  })
  expect(stateRequests(h)).toHaveLength(2)
})

for (const [name, contract, tag] of [
  ["INTERNAL_ERROR", accountId, "RpcError"],
  ["NO_CONTRACT_CODE", "other.testnet", "DecodeError"],
] as const) {
  it(`does not swallow ${name} / ${contract} as code absence`, async () => {
    const h = harness((request) =>
      request.params.request_type === "view_code"
        ? codeRejection(request, name, contract)
        : fixture(request),
    )
    const failure = await Effect.runPromise(
      h.provide(program()).pipe(Effect.flip),
    )
    expect(failure._tag).toBe(tag)
    expect((await records(`${output}.partial`)).map((row) => row.type)).toEqual(
      ["begin"],
    )
    await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
    expect(stateRequests(h)).toHaveLength(0)
  })
}

it("retains the written prefix and closes the writer on a later read failure", async () => {
  const files = trackFile()
  const h = harness((request) => {
    if (Object.hasOwn(request.params, "after_key_base64"))
      throw new Error("offline")
    return fixture(request)
  })
  const failure = await Effect.runPromise(
    h.provide(program()).pipe(Effect.flip),
  )
  expect(failure).toMatchObject({
    _tag: "TransportError",
    operation: "statePage",
  })
  expect(files[0]?.fd).toBe(-1)
  expect((await records(`${output}.partial`)).map((row) => row.type)).toEqual([
    "begin",
    "header",
    "state-page",
  ])
  await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
  expect(stateRequests(h)).toHaveLength(2)
})

it("interrupts a page body, closes the writer, and never publishes or fetches the next page", async () => {
  const files = trackFile()
  let started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  let bodyCanceled = false
  const h = harness((request) => {
    if (!Object.hasOwn(request.params, "after_key_base64"))
      return fixture(request)
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":`,
            ),
          )
          started()
        },
        cancel() {
          bodyCanceled = true
        },
      }),
    )
  })
  const controller = new AbortController()
  const running = Effect.runPromiseExit(h.provide(program()), {
    signal: controller.signal,
  })
  await reading
  controller.abort()
  const exit = await running
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true)
  expect(files[0]?.fd).toBe(-1)
  expect((await records(`${output}.partial`)).map((row) => row.type)).toEqual([
    "begin",
    "header",
    "state-page",
  ])
  await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
  expect(stateRequests(h)).toHaveLength(2)
  expect(bodyCanceled || stateRequests(h)[1]?.init.signal?.aborted).toBe(true)
})

it("stops at a failed page write and keeps the prior records partial", async () => {
  const files = trackFile((file) => {
    const write = file.writeFile.bind(file)
    let pageWrites = 0
    vi.spyOn(file, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).includes('"type":"state-page"') && ++pageWrites === 2)
        throw new Error("disk full")
      return write(...args)
    })
  })
  const h = harness((request) =>
    Object.hasOwn(request.params, "after_key_base64")
      ? {
          ...metadata,
          values: [{ key: "/w==", value: "AP8B" }],
          last_key: "/w==",
        }
      : fixture(request),
  )
  const failure = await Effect.runPromise(
    h.provide(program()).pipe(Effect.flip),
  )
  expect(failure).toMatchObject({ _tag: "OutputError", operation: "write" })
  expect(files[0]?.fd).toBe(-1)
  expect((await records(`${output}.partial`)).map((row) => row.type)).toEqual([
    "begin",
    "header",
    "state-page",
  ])
  await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
  expect(stateRequests(h)).toHaveLength(2)
})

for (const operation of ["sync", "close"] as const) {
  it(`does not publish when ${operation} fails after traversal`, async () => {
    const files = trackFile((file) => {
      const original = file[operation].bind(file)
      vi.spyOn(file, operation).mockImplementation(async () => {
        await original()
        throw new Error("filesystem failure")
      })
    })
    const h = harness(fixture)
    const failure = await Effect.runPromise(
      h.provide(program()).pipe(Effect.flip),
    )
    expect(failure).toMatchObject({ _tag: "OutputError", operation })
    expect(files[0]?.fd).toBe(-1)
    // A full traversal remains explicitly partial until publication, even with end.
    expect((await records(`${output}.partial`)).at(-1)?.type).toBe("end")
    await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
  })
}

it("preserves an existing partial file without making any read requests", async () => {
  await fs.writeFile(`${output}.partial`, "prior incomplete attempt")
  const h = harness(fixture)
  expect(
    await Effect.runPromise(h.provide(program()).pipe(Effect.flip)),
  ).toMatchObject({ _tag: "OutputError", operation: "open" })
  expect(h.requests).toHaveLength(0)
  expect(await fs.readFile(`${output}.partial`, "utf8")).toBe(
    "prior incomplete attempt",
  )
})

it("does not replace an existing completed output at publication", async () => {
  await fs.writeFile(output, "prior export")
  const h = harness(fixture)
  expect(
    await Effect.runPromise(h.provide(program()).pipe(Effect.flip)),
  ).toMatchObject({ _tag: "OutputError", operation: "publish" })
  expect(await fs.readFile(output, "utf8")).toBe("prior export")
  expect((await records(`${output}.partial`)).at(-1)?.type).toBe("end")
})

it("imports without starting I/O or registering signal handlers and gives CLI usage errors", async () => {
  const recipe = new URL("../examples/snapshot-export.ts", import.meta.url)
  const script = `
    let reads = 0;
    globalThis.fetch = async () => { reads++; throw Error('unexpected network'); };
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    process.argv = [process.execPath, 'consumer.mjs', 'https://example.test', '${accountId}', ${JSON.stringify(output)}];
    await import(${JSON.stringify(recipe.href)});
    if (reads || before[0] !== process.listenerCount('SIGINT') || before[1] !== process.listenerCount('SIGTERM')) throw Error('import side effect');
  `
  const imported = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { encoding: "utf8" },
  )
  expect(imported.status, imported.stderr).toBe(0)
  const invalid = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(recipe)],
    { encoding: "utf8" },
  )
  expect(invalid.status, invalid.stderr).toBe(2)
  expect(invalid.stderr).toContain("Usage: snapshot-export.ts")
  await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" })
  await expect(fs.stat(`${output}.partial`)).rejects.toMatchObject({
    code: "ENOENT",
  })
})

it("runs the CLI application and restores signal handlers on success and failure", async () => {
  const h = harness(fixture)
  vi.spyOn(globalThis, "fetch").mockImplementation(h.fetch)
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const before = [
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ]
  expect(await main(["https://example.test/rpc", accountId, output])).toBe(0)
  expect(log).toHaveBeenCalledWith(`Snapshot complete: ${output}`)
  expect((await records(output)).at(-1)?.type).toBe("end")
  expect(h.requests).toHaveLength(7)
  const failedOutput = join(directory, "failed.ndjson")
  expect(await main(["not-a-url-SECRET", accountId, failedOutput])).toBe(1)
  expect(error).toHaveBeenCalledOnce()
  expect(error.mock.calls[0]?.[0]).toContain("failed or interrupted")
  expect(error.mock.calls[0]?.[0]).not.toContain("SECRET")
  expect(h.requests).toHaveLength(7)
  expect(
    (await records(`${failedOutput}.partial`)).map((row) => row.type),
  ).toEqual(["begin"])
  expect([
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ]).toEqual(before)
})
