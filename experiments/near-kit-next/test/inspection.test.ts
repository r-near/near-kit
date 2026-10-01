import { it } from "@effect/vitest"
import { Effect } from "effect"
import type { HttpClient } from "effect/http/HttpClient"
import { expect } from "vitest"
import * as Near from "../src/index.js"
import * as Operator from "../src/operator.js"
import { HASH, harness, OTHER_HASH, type WireRequest } from "./fixtures.js"

// Source-derived mocked transport evidence only, not real-node conformance.
const client = Near.make({ url: "https://example.test/rpc" })
const accountId = "fixture.testnet"
const publicKey = `ed25519:${"1".repeat(32)}`
const otherKey = `ed25519:${"1".repeat(31)}2`
const handle = `ml-dsa-65-hash:${"1".repeat(32)}`
const secpKey = `secp256k1:${"1".repeat(64)}`
const metadata = { block_hash: HASH, block_height: 123 }
const maxU128 = "340282366920938463463374607431768211455"
type Read = Effect.Effect<unknown, Near.ReadError, HttpClient>

function rawResult(request: WireRequest, result: string): Response {
  return new Response(
    `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":${result}}`,
    { headers: { "content-type": "application/json" } },
  )
}

function rejection(request: WireRequest, name: string, info: unknown) {
  return {
    jsonrpc: "2.0",
    id: request.id,
    error: {
      code: -32000,
      message: "untrusted provider text",
      name: "HANDLER_ERROR",
      cause: { name, info },
    },
  }
}

for (const [token, expected] of [
  ["0", 0n],
  ["9007199254740991", 9007199254740991n],
  ["9007199254740992", 9007199254740992n],
  ["9007199254740993", 9007199254740993n],
  ["18446744073709551615", 18446744073709551615n],
] as const) {
  it.effect(`preserves access-key raw u64 token ${token}`, () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          `{"nonce":${token},"permission":"FullAccess","block_hash":"${HASH}","block_height":9007199254740993}`,
        ),
      )
      const value = yield* h.provide(
        Near.accessKey(client, accountId, publicKey, { at: { hash: HASH } }),
      )
      expect(value).toEqual({
        nonce: expected,
        permission: { kind: "FullAccess" },
        blockHash: HASH,
        blockHeight: 9007199254740993n,
      })
      expect(h.requests[0]?.request).toMatchObject({
        method: "query",
        params: {
          request_type: "view_access_key",
          account_id: accountId,
          public_key: publicKey,
          block_id: HASH,
        },
      })
    }),
  )
}

it.effect(
  "serializes an explicit unsafe-range height without rounding it before the request",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          `{"nonce":0,"permission":"FullAccess","block_hash":"${HASH}","block_height":9007199254740993}`,
        ),
      )
      const result = yield* h.provide(
        Near.accessKey(client, accountId, publicKey, {
          at: { height: 9007199254740993n },
        }),
      )
      expect(result.blockHeight).toBe(9007199254740993n)
      // The shared harness intentionally uses ordinary JSON.parse for inspection;
      // inspect the original request text for a full-range integer assertion.
      expect(String(h.requests[0]?.init.body)).toContain(
        '"block_id":9007199254740993',
      )
    }),
)

it.effect(
  "projects all permission variants and preserves historical receiver strings",
  () =>
    Effect.gen(function* () {
      const cases = [
        ["FullAccess", { kind: "FullAccess" }],
        [
          {
            FunctionCall: {
              allowance: null,
              receiver_id: "historically invalid receiver!",
              method_names: [],
            },
          },
          {
            kind: "FunctionCall",
            allowance: null,
            receiverId: "historically invalid receiver!",
            methodNames: [],
          },
        ],
        [
          {
            FunctionCall: {
              allowance: "0",
              receiver_id: accountId,
              method_names: ["echo"],
            },
          },
          {
            kind: "FunctionCall",
            allowance: 0n,
            receiverId: accountId,
            methodNames: ["echo"],
          },
        ],
        [
          {
            FunctionCall: {
              allowance: maxU128,
              receiver_id: accountId,
              method_names: ["echo", "json"],
            },
          },
          {
            kind: "FunctionCall",
            allowance: BigInt(maxU128),
            receiverId: accountId,
            methodNames: ["echo", "json"],
          },
        ],
        [
          { GasKeyFullAccess: { balance: maxU128, num_nonces: 65535 } },
          {
            kind: "GasKeyFullAccess",
            balance: BigInt(maxU128),
            numNonces: 65535,
          },
        ],
        [
          {
            GasKeyFunctionCall: {
              balance: "0",
              num_nonces: 0,
              allowance: null,
              receiver_id: accountId,
              method_names: [],
            },
          },
          {
            kind: "GasKeyFunctionCall",
            balance: 0n,
            numNonces: 0,
            allowance: null,
            receiverId: accountId,
            methodNames: [],
          },
        ],
      ] as const
      for (const [permission, expected] of cases) {
        const h = harness(() => ({ ...metadata, nonce: 1, permission }))
        expect(
          (yield* h.provide(Near.accessKey(client, accountId, publicKey)))
            .permission,
        ).toEqual(expected)
      }
    }),
)

it.effect(
  "reads an exact mixed legacy key list and distinguishes full keys from handles",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          `{
    "block_hash":"${HASH}","block_height":123,"last_key":null,"keys":[
      {"public_key":"${publicKey}","access_key":{"nonce":9007199254740993,"permission":"FullAccess"}},
      {"public_key":"${secpKey}","access_key":{"nonce":18446744073709551615,"permission":{"FunctionCall":{"allowance":null,"receiver_id":"sandbox","method_names":[]}}}},
      {"public_key":"${handle}","access_key":{"nonce":0,"permission":{"GasKeyFullAccess":{"balance":"1","num_nonces":2}}}},
      {"public_key":"${otherKey}","access_key":{"nonce":1,"permission":{"GasKeyFunctionCall":{"balance":"2","num_nonces":1,"allowance":null,"receiver_id":"sandbox","method_names":["echo"]}}}}
    ]}`,
        ),
      )
      const result = yield* h.provide(Near.accessKeys(client, accountId))
      expect(result.keys.map((key) => key.publicKey.kind)).toEqual([
        "ed25519",
        "secp256k1",
        "ml-dsa-65-hash",
        "ed25519",
      ])
      expect(result.keys.map((key) => key.accessKey.nonce)).toEqual([
        9007199254740993n,
        18446744073709551615n,
        0n,
        1n,
      ])
      expect(result.keys.map((key) => key.accessKey.permission.kind)).toEqual([
        "FullAccess",
        "FunctionCall",
        "GasKeyFullAccess",
        "GasKeyFunctionCall",
      ])
      expect(result.keys[2]?.publicKey.data).toEqual(new Uint8Array(32))
      const firstKey = result.keys[0]
      if (firstKey === undefined) throw new Error("Missing first key")
      firstKey.publicKey.data[0] = 255
      expect(result.keys[2]?.publicKey.data[0]).toBe(0)
      expect(h.requests[0]?.request.params).toEqual({
        request_type: "view_access_key_list",
        account_id: accountId,
        finality: "final",
      })
      const empty = harness(() => ({ ...metadata, keys: [] }))
      expect(
        (yield* empty.provide(Near.accessKeys(client, "missing.testnet"))).keys,
      ).toEqual([])
      expect(empty.requests).toHaveLength(1)
    }),
)

for (const cursor of [publicKey, handle]) {
  it.effect(
    "rejects a supported-shaped key continuation rather than claiming completeness",
    () =>
      Effect.gen(function* () {
        const h = harness(() => ({ ...metadata, keys: [], last_key: cursor }))
        expect(
          yield* h
            .provide(Near.accessKeys(client, accountId))
            .pipe(Effect.flip),
        ).toMatchObject({
          _tag: "UnsupportedError",
          feature: "AccessKeyPagination",
        })
        expect(h.requests).toHaveLength(1)
      }),
  )
}

it.effect(
  "rejects a listed hash handle before a full-key lookup, while accepting full ML-DSA text",
  () =>
    Effect.gen(function* () {
      const reads: readonly Read[] = [
        Near.accessKey(client, accountId, handle),
        Near.gasKeyNonces(client, accountId, handle),
      ]
      for (const read of reads) {
        const h = harness()
        expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
          _tag: "RequestError",
          reason: "PublicKey",
        })
        expect(h.requests).toHaveLength(0)
      }
      const full = `ml-dsa-65:${"1".repeat(1952)}`
      const h = harness(() => ({
        ...metadata,
        nonce: 0,
        permission: "FullAccess",
      }))
      yield* h.provide(Near.accessKey(client, accountId, full))
      expect(h.requests[0]?.request.params.public_key).toBe(full)
    }),
)

it.effect(
  "preserves gas-lane order and exact raw u64 boundaries, including an empty result",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          `{"block_hash":"${HASH}","block_height":123,"nonces":[18446744073709551615,0,9007199254740993,9007199254740991,9007199254740992]}`,
        ),
      )
      expect(
        (yield* h.provide(Near.gasKeyNonces(client, accountId, publicKey)))
          .nonces,
      ).toEqual([
        18446744073709551615n,
        0n,
        9007199254740993n,
        9007199254740991n,
        9007199254740992n,
      ])
      expect(h.requests[0]?.request.params).toMatchObject({
        request_type: "view_gas_key_nonces",
        public_key: publicKey,
        finality: "final",
      })
      const empty = harness(() => ({ ...metadata, nonces: [] }))
      expect(
        (yield* empty.provide(Near.gasKeyNonces(client, accountId, publicKey)))
          .nonces,
      ).toEqual([])
    }),
)

for (const token of [
  "-1",
  "-0",
  "1.0",
  "1e0",
  "1e-500",
  "18446744073709551616",
  '"1"',
]) {
  it.effect(
    `rejects noncanonical/out-of-range nonce token ${token} at each nesting level`,
    () =>
      Effect.gen(function* () {
        const responses: readonly (readonly [string, Read])[] = [
          [
            `{"nonce":${token},"permission":"FullAccess"}`,
            Near.accessKey(client, accountId, publicKey),
          ],
          [
            `{"keys":[{"public_key":"${publicKey}","access_key":{"nonce":${token},"permission":"FullAccess"}}]}`,
            Near.accessKeys(client, accountId),
          ],
          [
            `{"nonces":[${token}]}`,
            Near.gasKeyNonces(client, accountId, publicKey),
          ],
        ]
        for (const [body, read] of responses) {
          const h = harness((request) =>
            rawResult(
              request,
              `{"block_hash":"${HASH}","block_height":123,${body.slice(1)}`,
            ),
          )
          expect((yield* h.provide(read).pipe(Effect.flip))._tag).toBe(
            "DecodeError",
          )
        }
      }),
  )
}

for (const permission of [
  { FullAccess: {} },
  { Unknown: {} },
  {
    FunctionCall: { allowance: null, receiver_id: "sandbox", method_names: [] },
    GasKeyFullAccess: { balance: "0", num_nonces: 1 },
  },
  {
    GasKeyFunctionCall: [
      { balance: "0", num_nonces: 2 },
      { allowance: null, receiver_id: "sandbox", method_names: [] },
    ],
  },
  ...[-1, 65536, 1.5, "1"].map((num_nonces) => ({
    GasKeyFullAccess: { balance: "0", num_nonces },
  })),
  ...["1\n", "01", "-1", "340282366920938463463374607431768211456"].flatMap(
    (amount) => [
      {
        FunctionCall: {
          allowance: amount,
          receiver_id: "sandbox",
          method_names: [],
        },
      },
      { GasKeyFullAccess: { balance: amount, num_nonces: 1 } },
    ],
  ),
]) {
  it.effect(
    `rejects malformed RPC permission ${JSON.stringify(permission)}`,
    () =>
      Effect.gen(function* () {
        const h = harness(() => ({ ...metadata, nonce: 0, permission }))
        expect(
          (yield* h
            .provide(Near.accessKey(client, accountId, publicKey))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }),
  )
}

it.effect(
  "distinguishes key absence from account absence and nongas-key unavailability",
  () =>
    Effect.gen(function* () {
      const missing = harness(
        (request) =>
          rejection(request, "UNKNOWN_ACCESS_KEY", {
            ...metadata,
            public_key: publicKey,
          }),
        false,
      )
      expect(
        yield* missing
          .provide(Near.accessKey(client, "missing.testnet", publicKey))
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "AccessKeyNotFound",
        accountId: "missing.testnet",
        publicKey,
      })
      const noAccount = harness(
        (request) =>
          rejection(request, "UNKNOWN_ACCOUNT", {
            ...metadata,
            requested_account_id: accountId,
          }),
        false,
      )
      expect(
        yield* noAccount
          .provide(Near.accessKey(client, accountId, publicKey))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "AccountNotFound", accountId })
      const nongas = harness(
        (request) =>
          rejection(request, "UNKNOWN_GAS_KEY", {
            ...metadata,
            public_key: publicKey,
          }),
        false,
      )
      expect(
        yield* nongas
          .provide(Near.gasKeyNonces(client, accountId, publicKey))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "GasKeyUnavailable" })
    }),
)

for (const [label, info] of [
  ["different key", { ...metadata, public_key: otherKey }],
  [
    "different block",
    { ...metadata, public_key: publicKey, block_hash: OTHER_HASH },
  ],
  ["missing echo", metadata],
] as const) {
  it.effect(`rejects structured key-absence ${label}`, () =>
    Effect.gen(function* () {
      const cases: readonly (readonly [string, Read])[] = [
        [
          "UNKNOWN_ACCESS_KEY",
          Near.accessKey(client, accountId, publicKey, { at: { hash: HASH } }),
        ],
        [
          "UNKNOWN_GAS_KEY",
          Near.gasKeyNonces(client, accountId, publicKey, {
            at: { hash: HASH },
          }),
        ],
      ]
      for (const [name, read] of cases) {
        const h = harness((request) => rejection(request, name, info), false)
        expect((yield* h.provide(read).pipe(Effect.flip))._tag).toBe(
          "DecodeError",
        )
      }
    }),
  )
}

it.effect(
  "checks successful block selectors for key lookup, list and lanes",
  () =>
    Effect.gen(function* () {
      const cases: readonly (readonly [unknown, Read])[] = [
        [
          { ...metadata, nonce: 0, permission: "FullAccess" },
          Near.accessKey(client, accountId, publicKey, {
            at: { height: 124n },
          }),
        ],
        [
          { ...metadata, keys: [] },
          Near.accessKeys(client, accountId, { at: { hash: OTHER_HASH } }),
        ],
        [
          { ...metadata, nonces: [] },
          Near.gasKeyNonces(client, accountId, publicKey, {
            at: { hash: OTHER_HASH },
          }),
        ],
      ]
      for (const [response, read] of cases) {
        const h = harness(() => response)
        expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
          _tag: "DecodeError",
          reason: "BlockMismatch",
        })
      }
    }),
)

it.effect(
  "downloads local and both global code forms with owned binary bytes and one request each",
  () =>
    Effect.gen(function* () {
      const h = harness(() => ({
        ...metadata,
        code_base64: "AP8B",
        hash: OTHER_HASH,
      }))
      const local = yield* h.provide(
        Near.code(client, accountId, { at: { hash: HASH } }),
      )
      const byHash = yield* h.provide(
        Near.globalCode(client, { hash: OTHER_HASH }, { at: { hash: HASH } }),
      )
      const publisher = yield* h.provide(
        Near.globalCode(
          client,
          { publisher: accountId },
          { at: { hash: HASH } },
        ),
      )
      for (const result of [local, byHash, publisher])
        expect(result).toEqual({
          bytes: new Uint8Array([0, 255, 1]),
          codeHash: OTHER_HASH,
          blockHash: HASH,
          blockHeight: 123n,
        })
      local.bytes[0] = 99
      expect(byHash.bytes[0]).toBe(0)
      expect(h.requests.map((value) => value.request.params)).toEqual([
        { request_type: "view_code", account_id: accountId, block_id: HASH },
        {
          request_type: "view_global_contract_code",
          code_hash: OTHER_HASH,
          block_id: HASH,
        },
        {
          request_type: "view_global_contract_code_by_account_id",
          account_id: accountId,
          block_id: HASH,
        },
      ])
    }),
)

it.effect(
  "requires the advertised global hash to match its explicit identifier",
  () =>
    Effect.gen(function* () {
      const h = harness(() => ({
        ...metadata,
        code_base64: "",
        hash: OTHER_HASH,
      }))
      expect(
        yield* h
          .provide(Near.globalCode(client, { hash: HASH }))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "DecodeError", reason: "IdentifierMismatch" })
      expect(
        (yield* h.provide(Near.globalCode(client, { publisher: accountId })))
          .bytes,
      ).toEqual(new Uint8Array())
      expect(h.requests).toHaveLength(2)
    }),
)

for (const change of [
  { code_base64: "AA" },
  { code_base64: "AB==" },
  { code_base64: "AA==\n" },
  { hash: "invalid" },
  { block_hash: OTHER_HASH },
]) {
  it.effect(
    `rejects malformed or mismatched code response ${JSON.stringify(change)}`,
    () =>
      Effect.gen(function* () {
        const h = harness(() => ({
          ...metadata,
          code_base64: "AA==",
          hash: HASH,
          ...change,
        }))
        expect(
          (yield* h
            .provide(Near.code(client, accountId, { at: { hash: HASH } }))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }),
  )
}

it.effect("rejects ambiguous global references before I/O", () =>
  Effect.gen(function* () {
    for (const reference of [
      {},
      { hash: HASH, publisher: accountId },
      { publisher: "invalid^account" },
    ]) {
      const h = harness()
      expect(
        (yield* h
          .provide(Near.globalCode(client, reference as never))
          .pipe(Effect.flip))._tag,
      ).toBe("RequestError")
      expect(h.requests).toHaveLength(0)
    }
  }),
)

it.effect(
  "recognizes code/global absence only with matching structured identifiers and blocks",
  () =>
    Effect.gen(function* () {
      const cases = [
        [
          "NO_CONTRACT_CODE",
          { ...metadata, contract_account_id: accountId },
          Near.code(client, accountId, { at: { hash: HASH } }),
          "CodeUnavailable",
        ],
        [
          "NO_GLOBAL_CONTRACT_CODE",
          { ...metadata, identifier: { hash: OTHER_HASH } },
          Near.globalCode(client, { hash: OTHER_HASH }, { at: { hash: HASH } }),
          "GlobalCodeUnavailable",
        ],
        [
          "NO_GLOBAL_CONTRACT_CODE",
          { ...metadata, identifier: { account_id: accountId } },
          Near.globalCode(
            client,
            { publisher: accountId },
            { at: { hash: HASH } },
          ),
          "GlobalCodeUnavailable",
        ],
      ] as const
      for (const [name, info, read, kind] of cases) {
        const h = harness((request) => rejection(request, name, info), false)
        expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
          _tag: "RpcError",
          kind,
        })
        const wrong = harness(
          (request) =>
            rejection(request, name, { ...info, block_hash: OTHER_HASH }),
          false,
        )
        expect((yield* wrong.provide(read).pipe(Effect.flip))._tag).toBe(
          "DecodeError",
        )
      }
      for (const identifier of [
        { hash: HASH },
        { account_id: "wrong.testnet" },
        { hash: OTHER_HASH, account_id: accountId },
      ]) {
        const h = harness(
          (request) =>
            rejection(request, "NO_GLOBAL_CONTRACT_CODE", {
              ...metadata,
              identifier,
            }),
          false,
        )
        expect(
          (yield* h
            .provide(Near.globalCode(client, { publisher: accountId }))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }
      const wrongLocal = harness(
        (request) =>
          rejection(request, "NO_CONTRACT_CODE", {
            ...metadata,
            contract_account_id: "wrong.testnet",
          }),
        false,
      )
      expect(
        (yield* wrongLocal
          .provide(Near.code(client, accountId))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const wrongHash = harness(
        (request) =>
          rejection(request, "NO_GLOBAL_CONTRACT_CODE", {
            ...metadata,
            identifier: { hash: HASH },
          }),
        false,
      )
      expect(
        (yield* wrongHash
          .provide(Near.globalCode(client, { hash: OTHER_HASH }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const internal = harness(
        (request) =>
          rejection(request, "INTERNAL_ERROR", {
            error_message: "NoGlobalContractCode",
          }),
        false,
      )
      expect(
        yield* internal
          .provide(Near.globalCode(client, { publisher: accountId }))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "Unknown" })
    }),
)

it.effect(
  "projects genesis as a summary with exact raw u64 fields and decimal supply",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          `{"chain_id":"fixture-chain","protocol_version":85,"genesis_height":9007199254740993,"epoch_length":18446744073709551615,"total_supply":"${maxU128}","genesis_time":"2026-10-01T00:00:00Z","ignored":{"value":1e500}}`,
        ),
      )
      expect(yield* h.provide(Operator.genesisSummary(client))).toEqual({
        chainId: "fixture-chain",
        protocolVersion: 85,
        genesisHeight: 9007199254740993n,
        epochLength: 18446744073709551615n,
        totalSupply: BigInt(maxU128),
        genesisTime: "2026-10-01T00:00:00Z",
      })
      expect(h.requests[0]?.request).toMatchObject({
        method: "genesis_config",
        params: [],
      })
      const absent = harness(() => ({
        chain_id: "fixture-chain",
        protocol_version: 85,
        genesis_height: 0,
        epoch_length: 100,
        total_supply: "0",
      }))
      expect(
        (yield* absent.provide(Operator.genesisSummary(client))).genesisTime,
      ).toBeUndefined()
      const malformed = harness(() => ({
        chain_id: "fixture-chain",
        protocol_version: 85,
        genesis_height: 0,
        epoch_length: 100,
        total_supply: "1\n",
      }))
      expect(
        (yield* malformed
          .provide(Operator.genesisSummary(client))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
)

it.effect(
  "preserves maintenance order and exact half-open endpoints without invented provenance",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        rawResult(
          request,
          '[{"start":9007199254740993,"end":18446744073709551615},{"start":0,"end":0},{"start":1,"end":2}]',
        ),
      )
      expect(
        yield* h.provide(Operator.maintenanceWindows(client, accountId)),
      ).toEqual([
        { start: 9007199254740993n, end: 18446744073709551615n },
        { start: 0n, end: 0n },
        { start: 1n, end: 2n },
      ])
      expect(h.requests[0]?.request).toMatchObject({
        method: "maintenance_windows",
        params: { account_id: accountId },
      })
      const empty = harness(() => [])
      expect(
        yield* empty.provide(Operator.maintenanceWindows(client, accountId)),
      ).toEqual([])
      for (const response of [
        [{ start: 2, end: 1 }],
        [{ start: -1, end: 1 }],
        [{ start: "1", end: 2 }],
      ]) {
        const wrong = harness(() => response)
        expect(
          (yield* wrong
            .provide(Operator.maintenanceWindows(client, accountId))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }
    }),
)

it.effect(
  "reads all block-effect categories and preserves duplicate account/category pairs",
  () =>
    Effect.gen(function* () {
      const kinds = [
        "account_touched",
        "access_key_touched",
        "data_touched",
        "contract_code_touched",
        "data_touched",
      ] as const
      const h = harness(() => ({
        block_hash: HASH,
        changes: kinds.map((type) => ({ type, account_id: accountId })),
      }))
      expect(
        yield* h.provide(Operator.blockEffects(client, { hash: HASH })),
      ).toEqual({
        blockHash: HASH,
        changes: kinds.map((kind) => ({ kind, accountId })),
      })
      expect(h.requests[0]?.request).toMatchObject({
        method: "block_effects",
        params: { block_id: HASH },
      })
      const empty = harness(() => ({ block_hash: HASH, changes: [] }))
      expect(
        (yield* empty.provide(Operator.blockEffects(client, { hash: HASH })))
          .changes,
      ).toEqual([])
      const wrong = harness(() => ({ block_hash: OTHER_HASH, changes: [] }))
      expect(
        (yield* wrong
          .provide(Operator.blockEffects(client, { hash: HASH }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const unknown = harness(() => ({
        block_hash: HASH,
        changes: [{ type: "gas_key_nonce_touched", account_id: accountId }],
      }))
      expect(
        (yield* unknown
          .provide(Operator.blockEffects(client, { hash: HASH }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      for (const at of [
        undefined,
        "final",
        { height: 123n },
        { hash: HASH, height: 123n },
      ]) {
        const invalid = harness()
        expect(
          (yield* invalid
            .provide(Operator.blockEffects(client, at as never))
            .pipe(Effect.flip))._tag,
        ).toBe("RequestError")
        expect(invalid.requests).toHaveLength(0)
      }
    }),
)

// Direct-operation error shapes traced to nearcore 2.13.4:
// chain/jsonrpc-primitives/src/types/{blocks,gas_price,changes}.rs.
it.effect(
  "accepts direct UNKNOWN_BLOCK empty info but keeps query's required block reference",
  () =>
    Effect.gen(function* () {
      const cases: readonly (readonly [string, Read])[] = [
        ["block", Near.block(client, { hash: HASH })],
        ["gas_price", Near.gasPrice(client, { hash: HASH })],
        ["block_effects", Operator.blockEffects(client, { hash: HASH })],
      ]
      for (const [method, read] of cases) {
        const h = harness(
          (request) => rejection(request, "UNKNOWN_BLOCK", {}),
          false,
        )
        expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
          _tag: "RpcError",
          kind: "UnknownBlock",
        })
        expect(h.requests).toHaveLength(1)
        expect(h.requests[0]?.request.method).toBe(method)
        const malformed = harness(
          (request) => rejection(request, "UNKNOWN_BLOCK", null),
          false,
        )
        expect((yield* malformed.provide(read).pipe(Effect.flip))._tag).toBe(
          "DecodeError",
        )
      }
      const query = Near.accessKey(client, accountId, publicKey, {
        at: { hash: HASH },
      })
      const missingReference = harness(
        (request) => rejection(request, "UNKNOWN_BLOCK", {}),
        false,
      )
      expect(
        (yield* missingReference.provide(query).pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
      const withReference = harness(
        (request) =>
          rejection(request, "UNKNOWN_BLOCK", {
            block_reference: { block_id: HASH },
          }),
        false,
      )
      expect(
        yield* withReference.provide(query).pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "UnknownBlock" })
    }),
)

it.effect(
  "recognizes unit NOT_SYNCED_YET only for the source-defined direct operations",
  () =>
    Effect.gen(function* () {
      const reads: readonly Read[] = [
        Near.block(client),
        Operator.blockEffects(client, { hash: HASH }),
      ]
      for (const read of reads) {
        const h = harness(
          (request) => rejection(request, "NOT_SYNCED_YET", undefined),
          false,
        )
        expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
          _tag: "RpcError",
          kind: "NodeNotSynced",
        })
        expect(h.requests).toHaveLength(1)
      }
      const wrongScope = harness(
        (request) => rejection(request, "NOT_SYNCED_YET", undefined),
        false,
      )
      expect(
        yield* wrongScope
          .provide(Near.gasPrice(client, "latest"))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "Unknown" })
    }),
)

it.effect(
  "validates SHARD_NOT_APPLIED info and keeps it distinct from a complete empty effects list",
  () =>
    Effect.gen(function* () {
      const h = harness(
        (request) =>
          new Response(
            `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"error":{"code":-32000,"message":"ignored","name":"HANDLER_ERROR","cause":{"name":"SHARD_NOT_APPLIED","info":{"shard_id":18446744073709551615}}}}`,
          ),
      )
      expect(
        yield* h
          .provide(Operator.blockEffects(client, { hash: HASH }))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "ShardUnavailable" })
      for (const info of [{}, null, { shard_id: -1 }, { shard_id: "1" }]) {
        const malformed = harness(
          (request) => rejection(request, "SHARD_NOT_APPLIED", info),
          false,
        )
        expect(
          (yield* malformed
            .provide(Operator.blockEffects(client, { hash: HASH }))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }
      const wrongScope = harness(
        (request) => rejection(request, "SHARD_NOT_APPLIED", { shard_id: 0 }),
        false,
      )
      expect(
        yield* wrongScope
          .provide(Near.accessKeys(client, accountId))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RpcError", kind: "Unknown" })
    }),
)

it.effect("validates and matches query UNKNOWN_BLOCK reference variants", () =>
  Effect.gen(function* () {
    const read = Near.account(client, accountId, { at: { hash: HASH } })
    for (const reference of [
      null,
      "final",
      {},
      { block_id: null },
      { block_id: HASH, finality: "final" },
    ]) {
      const h = harness(
        (request) =>
          rejection(request, "UNKNOWN_BLOCK", { block_reference: reference }),
        false,
      )
      expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
        _tag: "DecodeError",
        reason: "InvalidEnvelope",
      })
    }
    for (const reference of [
      { block_id: OTHER_HASH },
      { block_id: 123 },
      { finality: "final" },
      { sync_checkpoint: "genesis" },
    ]) {
      const h = harness(
        (request) =>
          rejection(request, "UNKNOWN_BLOCK", { block_reference: reference }),
        false,
      )
      expect(yield* h.provide(read).pipe(Effect.flip)).toMatchObject({
        _tag: "DecodeError",
        reason: "BlockMismatch",
      })
    }
    const finality = harness(
      (request) =>
        rejection(request, "UNKNOWN_BLOCK", {
          block_reference: { finality: "final" },
        }),
      false,
    )
    expect(
      yield* finality
        .provide(Near.account(client, accountId))
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "RpcError", kind: "UnknownBlock" })
    const height = harness(
      (request) =>
        new Response(
          `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"error":{"code":-32000,"message":"ignored","name":"HANDLER_ERROR","cause":{"name":"UNKNOWN_BLOCK","info":{"block_reference":{"block_id":18446744073709551615}}}}}`,
        ),
    )
    expect(
      yield* height
        .provide(
          Near.account(client, accountId, {
            at: { height: 18446744073709551615n },
          }),
        )
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "RpcError", kind: "UnknownBlock" })
  }),
)
it.effect(
  "does not interpret a future non-null key continuation as a supported cursor",
  () =>
    Effect.gen(function* () {
      for (const cursor of [
        { opaque: "next" },
        [1, 2],
        false,
        0,
        "future-cursor",
      ]) {
        const h = harness(() => ({ ...metadata, keys: [], last_key: cursor }))
        expect(
          yield* h
            .provide(Near.accessKeys(client, accountId))
            .pipe(Effect.flip),
        ).toMatchObject({
          _tag: "UnsupportedError",
          feature: "AccessKeyPagination",
        })
      }
    }),
)
