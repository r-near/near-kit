import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { base58 } from "@scure/base"
import { Effect } from "effect"
import { expect, it } from "vitest"
import * as Data from "../src/data.js"
import * as Near from "../src/index.js"
import * as Operator from "../src/operator.js"
import { harness } from "./fixtures.js"

// Offline replay of captured public-node reads, not fresh network conformance.
// Provenance retains the original wire bytes; only the envelope ID is rebound.
interface CompressedCapture {
  file: string
  bytes: number
  sha256: string
  gzipBytes: number
  gzipSha256: string
}
interface CaptureBase {
  name: string
  request: { method: string; params: Record<string, unknown> }
  response: CompressedCapture
}
type Capture = CaptureBase &
  (
    | {
        operation: "globalCode"
        reference: Near.GlobalReference
        expected: {
          blockHash: string
          blockHeight: string
          codeHash: string
          bytes: number
          wasmMagic: string
        }
      }
    | {
        operation: "blockEffects"
        expected: {
          blockHash: string
          blockHeight: string
          changes: Operator.BlockEffects["changes"]
          counts: Record<string, number>
        }
      }
  )
const root = new URL("./fixtures/protocol/", import.meta.url)
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
) as {
  captures: Capture[]
  networks: Record<
    string,
    { statusResponse: CompressedCapture; blockResponse: CompressedCapture }
  >
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
function original(capture: CompressedCapture) {
  const compressed = readFileSync(new URL(capture.file, root))
  expect(compressed.length).toBe(capture.gzipBytes)
  expect(sha256(compressed)).toBe(capture.gzipSha256)
  const bytes = gunzipSync(compressed)
  expect(bytes.length).toBe(capture.bytes)
  expect(sha256(bytes)).toBe(capture.sha256)
  return bytes.toString("utf8")
}

it("retains the exact status and block evidence for each public capture", () => {
  for (const network of Object.values(manifest.networks)) {
    original(network.statusResponse)
    original(network.blockResponse)
  }
})

for (const capture of manifest.captures) {
  it(`replays ${capture.name} from its complete public-node response`, async () => {
    const raw = original(capture.response)
    const h = harness((request) => {
      expect(request.method).toBe(capture.request.method)
      expect(request.params).toEqual(capture.request.params)
      return new Response(
        raw.replace(/("id"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(request.id)}`),
        { headers: { "content-type": "application/json" } },
      )
    })
    const client = Near.make({ url: "https://offline-capture.test/rpc" })
    const at = { hash: capture.expected.blockHash }
    if (capture.operation === "globalCode") {
      const code = await Effect.runPromise(
        h.provide(Near.globalCode(client, capture.reference, { at })),
      )
      expect(code.blockHash).toBe(at.hash)
      expect(code.blockHeight).toBe(BigInt(capture.expected.blockHeight))
      expect(code.bytes.length).toBe(capture.expected.bytes)
      expect(code.codeHash).toBe(capture.expected.codeHash)
      expect(
        base58.encode(createHash("sha256").update(code.bytes).digest()),
      ).toBe(capture.expected.codeHash)
      expect(Buffer.from(code.bytes.slice(0, 8)).toString("hex")).toBe(
        capture.expected.wasmMagic,
      )
    } else {
      const effects = await Effect.runPromise(
        h.provide(Operator.blockEffects(client, at)),
      )
      expect(effects.blockHash).toBe(at.hash)
      expect(effects.changes).toEqual(capture.expected.changes)
      expect(new Set(effects.changes.map((change) => change.kind))).toEqual(
        new Set(Object.keys(capture.expected.counts)),
      )
    }
    expect(h.requests).toHaveLength(1)
  })
}

it("pins the upstream full ML-DSA public key and its independently checked handle", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("ml-dsa-kat-public.json", root), "utf8"),
  ) as {
    publicKey: string
    publicKeyBytes: number
    publicKeySha256: string
    publicKeyHandle: string
  }
  const full = Data.parsePublicKey(fixture.publicKey)
  expect(full.kind).toBe("ml-dsa-65")
  expect(full.data.length).toBe(fixture.publicKeyBytes)
  expect(sha256(full.data)).toBe(fixture.publicKeySha256)
  expect(Data.formatPublicKey(full)).toBe(fixture.publicKey)
  const digest = createHash("sha3-256")
    .update("near:ml-dsa-65-pubkey-hash:v1")
    .update(full.data)
    .digest()
  expect(`ml-dsa-65-hash:${base58.encode(digest)}`).toBe(fixture.publicKeyHandle)
  expect(Data.parsePublicKey(fixture.publicKeyHandle)).toEqual({
    kind: "ml-dsa-65-hash",
    data: new Uint8Array(digest),
  })
})
