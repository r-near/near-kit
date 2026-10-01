/**
 * Bounded, packed consumers for the added address, NEP-413 and SSR workflows.
 * Run only after the exact crypto dependency/source review gate is satisfied.
 * Usage: node scripts/bench/gaps.mjs ARCHIVE SHA256 [unique-run-name]
 * Requires the project's pinned dependencies; never installs or signs anything.
 * Historical comparison uses the retained immutable bench-next artifact by default;
 * set BENCH_GAPS_PREVIOUS to another explicitly pinned packed installation.
 */
import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { arch, cpus, freemem, loadavg, platform, release } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { build, version as esbuild, transform } from "esbuild"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const [archiveArgument, expected, runName = "final"] = process.argv.slice(2)
assert(
  archiveArgument && /^[a-f0-9]{64}$/.test(expected ?? ""),
  "Provide archive and SHA256",
)
assert(/^[a-zA-Z0-9_-]+$/.test(runName), "Use a simple unique run name")
const sha = (value) => createHash("sha256").update(value).digest("hex")
const archive = resolve(archiveArgument)
assert.equal(sha(await readFile(archive)), expected)
const work = join(root, "artifacts/bench-gaps", runName)
await mkdir(dirname(work), { recursive: true })
await mkdir(work, { recursive: false }) // Refuse to mutate retained runs.
const write = async (name, contents) => {
  await mkdir(dirname(join(work, name)), { recursive: true })
  await writeFile(join(work, name), contents)
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))
// A separate package scope is essential: otherwise Node/esbuild self-reference
// resolves @near-kit/next back to the checkout rather than the packed artifact.
await write(
  "package.json",
  json({ name: "near-kit-gap-consumer", private: true, type: "module" }),
)
await write(
  "previous/package.json",
  json({
    name: "near-kit-previous-gap-consumer",
    private: true,
    type: "module",
  }),
)
const packed = join(work, "node_modules/@near-kit/next")
await mkdir(packed, { recursive: true })
execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", packed])
await cp(archive, join(work, "candidate.tgz"))
await cp(fileURLToPath(import.meta.url), join(work, "harness.mjs"))
const manifest = await readJson(join(packed, "package.json"))
assert.equal(manifest.name, "@near-kit/next")
const hasAuth = Boolean(manifest.exports["./nep413"])

async function files(path, prefix = "") {
  const result = {}
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory())
      Object.assign(
        result,
        await files(join(path, entry.name), `${prefix + entry.name}/`),
      )
    else if (entry.isFile()) {
      const bytes = await readFile(join(path, entry.name))
      result[prefix + entry.name] = { bytes: bytes.length, sha256: sha(bytes) }
    }
  }
  return result
}
async function packageCost(path) {
  const items = await files(path)
  const pkg = await readJson(join(path, "package.json"))
  return {
    name: pkg.name,
    version: pkg.version,
    dependencies: pkg.dependencies ?? {},
    bytes: Object.values(items).reduce((sum, item) => sum + item.bytes, 0),
    fileCount: Object.keys(items).length,
  }
}
const previous = resolve(
  process.env.BENCH_GAPS_PREVIOUS ??
    join(root, "artifacts/bench-next/node_modules/@near-kit/next"),
)
const previousFiles = await files(previous)
const oldProvenance = await readJson(
  join(root, "artifacts/bench-next/provenance.json"),
)
for (const [name, digest] of Object.entries(oldProvenance.packedDist))
  assert.equal(
    previousFiles[`dist/${name}`]?.sha256,
    digest,
    `Historical dist changed: ${name}`,
  )
await mkdir(join(work, "previous/node_modules/@near-kit"), { recursive: true })
// Copy only the tiny verified packed SDK. A symlink would resolve its own old
// node_modules and duplicate Effect alongside the consumer's same-version copy.
const previousInstalled = join(work, "previous/node_modules/@near-kit/next")
await cp(previous, previousInstalled, { recursive: true })
const packageFiles = await files(packed)
const currentMembers = {
  ...Object.fromEntries(
    Object.entries(await files(join(root, "dist"))).map(([name, value]) => [
      `dist/${name}`,
      value,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(await files(join(root, "examples"))).map(([name, value]) => [
      `examples/${name}`,
      value,
    ]),
  ),
}
const memberMismatches = Object.entries(currentMembers)
  .filter(([name, value]) => packageFiles[name]?.sha256 !== value.sha256)
  .map(([name]) => name)
memberMismatches.push(
  ...Object.keys(packageFiles).filter(
    (name) =>
      /^(dist|examples)\//.test(name) && !Object.hasOwn(currentMembers, name),
  ),
)
assert.deepEqual(
  memberMismatches,
  [],
  "Packed dist/examples do not match the current build/examples",
)
const dependencies = await Promise.all(
  Object.keys(manifest.dependencies).map((name) =>
    packageCost(join(root, "node_modules", name)),
  ),
)
for (const dependency of dependencies)
  assert.equal(dependency.version, manifest.dependencies[dependency.name])

for (const name of [
  "ssr-account.tsx",
  "ssr-account-server.tsx",
  "ssr-account-client.tsx",
  ...(hasAuth ? ["authentication-server.ts"] : []),
]) {
  const source = await readFile(join(packed, "examples", name), "utf8")
  const compiled = await transform(source, {
    loader: name.endsWith("tsx") ? "tsx" : "ts",
    jsx: "automatic",
    format: "esm",
    target: "es2022",
    sourcefile: name,
  })
  await write(`examples/${name.replace(/\.tsx?$/, ".js")}`, compiled.code)
}
await write(
  "examples/reference-client.js",
  (
    await readFile(join(work, "examples/ssr-account-client.js"), "utf8")
  ).replaceAll('"./ssr-account.js"', '"./reference-shared.js"'),
)
await write(
  "fixtures/address.json",
  await readFile(join(root, "test/fixtures/address.json")),
)
if (hasAuth)
  await write(
    "fixtures/nep413.json",
    await readFile(join(root, "test/fixtures/nep413/vectors.json")),
  )

// Same component, document structure and Query options, with a simpler direct-fetch
// reference. Its transport/DTO validation is deliberately weaker than the candidate.
const reference = `
import { createElement as h } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
export const makeSource = () => ({ key: "fixed-public-source", client: { url: "https://fixture.invalid/rpc" } });
const identity = value => ({requestId:value.requestId, sourceKey:value.sourceKey, accountId:value.accountId});
export const parseSsrAccount = (json, expected) => { const wire=JSON.parse(json); if(wire.requestId!==expected.requestId || wire.sourceKey!==expected.sourceKey || wire.accountId!==expected.accountId) throw Error("identity"); return Object.freeze({...identity(wire), amount:BigInt(wire.amount), blockHeight:BigInt(wire.blockHeight), blockHash:wire.blockHash}); };
export const serializeSsrAccount = value => JSON.stringify({version:1,...identity(value),amount:String(value.amount),blockHeight:String(value.blockHeight),blockHash:value.blockHash}).replace(/</g,"\\u003c");
export async function readSsrAccount(source, expected, signal) { const response=await fetch(source.client.url,{method:"POST",signal,headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"reference",method:"query",params:{request_type:"view_account",account_id:expected.accountId,finality:"final"}})}); if(!response.ok)throw Error("http"); const wire=await response.json(); if(wire.error)throw Error("rpc"); return Object.freeze({...identity(expected),amount:BigInt(wire.result.amount),blockHeight:BigInt(wire.result.block_height),blockHash:wire.result.block_hash}); }
export const ssrAccountQueryOptions=(source,initial)=>({queryKey:["ssr-account",initial.requestId,initial.sourceKey,initial.accountId],queryFn:({signal})=>readSsrAccount(source,identity(initial),signal),initialData:initial,staleTime:Infinity,retry:false,retryOnMount:false,refetchOnMount:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchInterval:false,gcTime:0,placeholderData:()=>undefined});
export function SsrAccount({source,initial}) {const client=useQueryClient();const options=ssrAccountQueryOptions(source,initial);const query=useQuery(options); return h("section",{"aria-label":"Account snapshot"},h("p",null,initial.accountId," · ",initial.sourceKey),h("p",null,query.data.amount.toString()," yoctoNEAR"),h("p",null,"Block ",query.data.blockHeight.toString()," · ",query.data.blockHash),query.isError&&h("p",{role:"alert"},"Could not refresh this account."),h("button",{type:"button",onClick:()=>void query.refetch(),disabled:query.isFetching},"Refresh"),h("button",{type:"button",onClick:()=>void client.cancelQueries({queryKey:options.queryKey,exact:true}),disabled:!query.isFetching},"Cancel refresh")); }
const attribute=text=>text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export async function accountPageResponse(request,options) { request.signal.throwIfAborted();const initial=await readSsrAccount(options.source,{requestId:crypto.randomUUID(),sourceKey:options.source.key,accountId:options.accountId},request.signal);const client=new QueryClient(); try{ const content=renderToString(h(QueryClientProvider,{client},h(SsrAccount,{source:options.source,initial})));const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account snapshot</title></head><body><div id="account-root" data-request-id="'+attribute(initial.requestId)+'" data-source-key="'+attribute(initial.sourceKey)+'" data-account-id="'+attribute(initial.accountId)+'">'+content+'</div><script id="account-data" type="application/json">'+serializeSsrAccount(initial)+'</script><script type="module" src="'+attribute(options.browserModule)+'"></script></body></html>';request.signal.throwIfAborted();return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}});}finally{client.clear();}}
`
// Split the server import so browser reference bundles cannot pull server rendering.
const serverOffset = reference.indexOf("const attribute=")
await write(
  "examples/reference-shared.js",
  reference
    .slice(0, serverOffset)
    .replace('import { renderToString } from "react-dom/server";', ""),
)
await write(
  "examples/reference-server.js",
  'import { createElement as h } from "react"; import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { renderToString } from "react-dom/server"; import { readSsrAccount, serializeSsrAccount, SsrAccount } from "./reference-shared.js";\n' +
    reference.slice(serverOffset),
)
const entries = {
  "candidate-root-read":
    'import * as Near from "@near-kit/next"; import * as Effect from "effect/Effect"; export function make(url) { const client=Near.make({url}); return (id,signal)=>Effect.runPromise(Near.account(client,id,{at:"final"}).pipe(Effect.provide(Near.fetchLayer)),{signal}); }',
  "candidate-data":
    'export { parseAccountId, parseHash, formatHash, parsePublicKey, formatPublicKey } from "@near-kit/next/data";',
  "candidate-units":
    'export { parseNear, formatNear, parseTgas, formatTgas } from "@near-kit/next/units";',
  "candidate-address":
    'export { deterministicAccountId } from "@near-kit/next/address";',
  "candidate-ssr-component":
    'export { SsrAccount, parseSsrAccount, serializeSsrAccount, ssrAccountQueryOptions } from "../examples/ssr-account.js"; export { make } from "@near-kit/next";',
  "reference-ssr-component":
    'export { SsrAccount, parseSsrAccount, serializeSsrAccount, ssrAccountQueryOptions, makeSource } from "../examples/reference-shared.js";',
  "candidate-ssr-server":
    'export { accountPageResponse } from "../examples/ssr-account-server.js"; export { parseSsrAccount, ssrAccountQueryOptions } from "../examples/ssr-account.js"; import { make } from "@near-kit/next"; export const makeSource=()=>({key:"fixed-public-source",client:make({url:"https://fixture.invalid/rpc"})});',
  "reference-ssr-server":
    'export { accountPageResponse } from "../examples/reference-server.js"; export { parseSsrAccount, ssrAccountQueryOptions, makeSource } from "../examples/reference-shared.js";',
}
entries["candidate-ssr-hydrate"] =
  'export { hydrateAccountPage } from "../examples/ssr-account-client.js"; export { make } from "@near-kit/next";'
entries["reference-ssr-hydrate"] =
  'export { hydrateAccountPage } from "../examples/reference-client.js"; export { makeSource } from "../examples/reference-shared.js";'
if (hasAuth) {
  entries["candidate-nep413"] =
    'export { verifyNep413Signature } from "@near-kit/next/nep413";'
  entries["candidate-receipt"] =
    'export { createReceiptServer } from "../examples/authentication-server.js"; export { make } from "@near-kit/next";'
}
for (const [label, source] of Object.entries(entries))
  await write(`entries/${label}.mjs`, source)
for (const label of [
  "candidate-root-read",
  "candidate-data",
  "candidate-units",
])
  await write(`previous/entries/${label}.mjs`, entries[label])

const worker = String.raw`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
const [mode,path,label,samplesText,warmupsText,work]=process.argv.slice(2);
const start=performance.now(); const module=await import(pathToFileURL(path)); const importMs=performance.now()-start;
const resolvedCandidate=import.meta.resolve("@near-kit/next");assert.equal(resolvedCandidate,pathToFileURL(work+"/node_modules/@near-kit/next/dist/index.js").href,"Node must use the packed consumer package");
const print=value=>process.stdout.write(JSON.stringify(value)+"\n");
if(mode==="import"){print({importMs,resolvedCandidate,memory:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS});process.exit(0);}
const samples=Number(samplesText),warmups=Number(warmupsText),timingsMs=[];
const amount="340282366920938463463374607431768211455",hash="11111111111111111111111111111111";
let requests=0,bytes=0,operation;
const localFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{assert.equal(String(input),"https://fixture.invalid/rpc");assert.equal(init.method,"POST");const rpc=JSON.parse(init.body);assert.equal(rpc.method,"query");assert.equal(rpc.params.account_id,"alice.testnet");assert.equal(rpc.params.finality,"final");assert.equal(rpc.params.request_type,"view_account");requests++;return new Response(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:{amount,locked:"0",storage_usage:410,code_hash:hash,block_height:123,block_hash:hash}}),{headers:{"content-type":"application/json"}});};
if(label==="candidate-address"){
 const vectors=JSON.parse(await readFile(work+"/fixtures/address.json","utf8")).map(v=>({...v,input:{code:v.code,data:v.data.map(([k,v])=>[Uint8Array.from(Buffer.from(k,"hex")),Uint8Array.from(Buffer.from(v,"hex"))])}}));
 operation=()=>{for(const v of vectors)assert.equal(module.deterministicAccountId(v.input),v.address);return vectors.length;};
} else if(label.startsWith("candidate-nep413-")){
 const fixture=JSON.parse(await readFile(work+"/fixtures/nep413.json","utf8"));const scheme=label.slice("candidate-nep413-".length);const vector=fixture.vectors.find(v=>v.id===scheme+"-receipt");assert(vector);const payload={...vector.payload,nonce:Uint8Array.from(Buffer.from(vector.payload.nonceHex,"hex"))};delete payload.nonceHex;
 operation=()=>{assert.equal(module.verifyNep413Signature(payload,vector.proof),true);return 1;};
} else if(label==="candidate-receipt"){
 const fixture=JSON.parse(await readFile(work+"/fixtures/nep413.json","utf8"));const app=fixture.app;const vector=fixture.vectors.find(v=>v.id==="ed25519-receipt");assert(vector);
 globalThis.fetch=async(input,init)=>{assert.equal(String(input),"https://fixture.invalid/rpc");const rpc=JSON.parse(init.body);assert.equal(rpc.method,"query");assert.equal(rpc.params.request_type,"view_access_key");assert.equal(rpc.params.account_id,app.accountId);assert.equal(rpc.params.public_key,vector.proof.publicKey);assert.equal(rpc.params.finality,"final");requests++;return new Response(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:{nonce:42,permission:"FullAccess",block_height:123,block_hash:hash}}),{headers:{"content-type":"application/json"}});};
 const source={id:app.sourceId,chain:app.chain,policy:app.policy,client:module.make({url:"https://fixture.invalid/rpc"})};
 operation=async()=>{let token=0;const server=module.createReceiptServer({now:()=>app.issuedAtMs,nonce:()=>Uint8Array.from(Buffer.from(vector.payload.nonceHex,"hex")),token:()=>{assert(token<app.tokenSequence.length);return app.tokenSequence[token++];},source});server.listen(0,"127.0.0.1");await once(server,"listening");const url="http://127.0.0.1:"+server.address().port;const before=requests;const request=(path,body,cookie="")=>localFetch(url+path,{method:body?"POST":"GET",headers:{origin:app.origin,"content-type":"application/json",cookie},...(body?{body:JSON.stringify(body)}:{})});try{const challengeResponse=await request("/challenge",{accountId:app.accountId});assert.equal(challengeResponse.status,200);const challenge=await challengeResponse.json();assert.equal(challenge.challengeId,app.challengeId);assert.equal(challenge.expires,app.expiresAtMs);assert.equal(challenge.payload.message,vector.payload.message);assert.equal(challenge.payload.recipient,vector.payload.recipient);assert.equal(challenge.payload.nonce,Buffer.from(vector.payload.nonceHex,"hex").toString("base64"));assert(challengeResponse.headers.get("set-cookie").includes("HttpOnly"));const proof={challengeId:challenge.challengeId,accountId:app.accountId,...vector.proof};const receiptResponse=await request("/receipt",proof,"challenge="+app.browserId);assert.equal(receiptResponse.status,200);const receipt=await receiptResponse.json();assert.deepEqual(receipt,{accountId:app.accountId,sourceId:app.sourceId,blockHash:hash,blockHeight:"123"});assert(receiptResponse.headers.get("set-cookie").includes("session="+app.sessionId));const meResponse=await request("/me",null,"session="+app.sessionId);assert.equal(meResponse.status,200);const session=await meResponse.json();assert.equal(session.accountId,app.accountId);assert.equal(session.publicKey,vector.proof.publicKey);assert.equal(session.expires,app.issuedAtMs+3600000);const replay=await request("/receipt",proof,"challenge="+app.browserId);assert.equal(replay.status,401);await replay.text();assert.equal(requests-before,1);assert.equal(token,3);bytes=Buffer.byteLength(JSON.stringify(receipt));return 1;}finally{server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
} else if(label.endsWith("-ssr-server")){
 const {QueryClient,QueryObserver}=await import("@tanstack/react-query");const source=module.makeSource();
 operation=async()=>{const before=requests;const response=await module.accountPageResponse(new Request("https://app.invalid/account"),{source,accountId:"alice.testnet",browserModule:"/account.js"});assert.equal(response.headers.get("cache-control"),"private, no-store");const html=await response.text();assert(html.includes(amount+"<!-- --> yoctoNEAR"));const match=/<script id="account-data" type="application\/json">(.*?)<\/script>/.exec(html);assert(match);const expected={requestId:/data-request-id="([^"]+)"/.exec(html)[1],sourceKey:"fixed-public-source",accountId:"alice.testnet"};const initial=module.parseSsrAccount(match[1],expected);assert.equal(initial.amount,BigInt(amount));assert.equal(initial.blockHeight,123n);assert.equal(initial.blockHash,hash);assert.equal(requests-before,1);const client=new QueryClient();const observer=new QueryObserver(client,module.ssrAccountQueryOptions(source,initial));const unsubscribe=observer.subscribe(()=>{});try{assert.deepEqual(observer.getCurrentResult().data,initial);assert.equal(requests-before,1);const refreshed=await observer.refetch();assert.equal(refreshed.status,"success");assert.deepEqual(refreshed.data,initial);assert.equal(requests-before,2);}finally{unsubscribe();observer.destroy();client.clear();}assert.equal(client.getQueryCache().getAll().length,0);bytes=Buffer.byteLength(html);return 2;};
} else throw Error("Unsupported workload: "+label);
for(let i=0;i<warmups;i++)await operation();
const beforeMemory=process.memoryUsage(),cpu=process.cpuUsage(),requestStart=requests;let operations=0;
for(let i=0;i<samples;i++){const start=performance.now();operations+=await operation();timingsMs.push(performance.now()-start);}
print({importMs,timingsMs,operations,requests:requests-requestStart,outputBytes:bytes,beforeMemory,afterMemory:process.memoryUsage(),cpuMicroseconds:process.cpuUsage(cpu),maxRssKiB:process.resourceUsage().maxRSS});
`
await write("worker.mjs", worker)

const rounds = Number(process.env.BENCH_GAPS_ROUNDS ?? 7)
const samples = Number(process.env.BENCH_GAPS_SAMPLES ?? 25)
const warmups = Number(process.env.BENCH_GAPS_WARMUPS ?? 5)
const importRounds = Number(process.env.BENCH_GAPS_IMPORT_ROUNDS ?? 15)
for (const n of [rounds, samples, warmups, importRounds])
  assert(Number.isSafeInteger(n) && n >= 0 && n <= 100)
let random = 20261001
const shuffled = (values) => {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    const j = (random >>> 0) % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
const raw = {
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceStatus: execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  }),
  candidateSha256: expected,
  packedManifest: manifest,
  packageFiles,
  currentMemberEquality: {
    checked: Object.keys(currentMembers).length,
    mismatches: memberMismatches,
  },
  sourceFiles: await files(join(root, "src")),
  previous: {
    candidateSha256: oldProvenance.candidateSha256,
    sourceCommit: oldProvenance.sourceCommit,
    packageFiles: previousFiles,
  },
  lockSha256: sha(await readFile(join(root, "package-lock.json"))),
  harnessSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  host: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    freeMemoryAtStart: freemem(),
    loadAtStart: loadavg(),
  },
  methodology: {
    rounds,
    samples,
    warmups,
    importRounds,
    shuffleSeed: 20261001,
    installation:
      "Exact supplied archive extracted as a standard public package; existing exact pinned dependencies resolve from the parent project's node_modules, without reinstalling SDK baselines. Installed costs sum actual regular package files, not filesystem blocks, caches or compressed transfer bytes.",
    runtime:
      "Fresh Node processes; import excludes process startup, wall includes it. Workloads retain all assertions. Address workload is six independent fixed public vectors; each verifier workload is one fixed valid public proof. SSR workload is an in-memory fixed RPC response, real Request-to-HTML route, DTO parse, QueryObserver initial data with zero extra read, explicit refresh, response assertions and cleanup. Complete receipt starts a fresh loopback HTTP server, issues a challenge, receives a fixed Ed25519 public proof, checks one mocked access-key read, fetches /me, rejects replay, checks request counts, and closes the server. No signing, browser hydration execution or external network. The direct-fetch React/Query reference has matching rendered output but weaker protocol and DTO validation.",
    bundle:
      "esbuild ESM ES2022 production; gzip9, Brotli11. Server entries are Node bundles with an included createRequire compatibility banner for ReactDOM's builtin imports; browser entries include their actual React/ReactDOM dependencies. Attribution is uncompressed emitted contribution, not compressed ownership.",
  },
  costs: {
    candidate: await packageCost(packed),
    previous: await packageCost(previous),
    dependencies,
    previousDependencies: await Promise.all(
      Object.keys(
        (await readJson(join(previous, "package.json"))).dependencies,
      ).map((name) => packageCost(join(root, "node_modules", name))),
    ),
    ssrApplicationPackages: await Promise.all(
      [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@tanstack/query-core",
        "scheduler",
      ].map((name) => packageCost(join(root, "node_modules", name))),
    ),
  },
  imports: [],
  workloads: [],
  bundles: [],
  executionChecks: [],
}
const save = () => write("raw.json", json(raw))
await save()
const classify = (input) =>
  input.includes("node_modules/@near-kit/next/")
    ? "candidate"
    : input.includes("node_modules/effect/")
      ? "effect"
      : input.includes("node_modules/@noble/")
        ? "noble"
        : input.includes("node_modules/@scure/")
          ? "scure"
          : input.includes("node_modules/")
            ? "other-dependencies"
            : "application"
const normalizeInput = (path) => {
  const marker = path.lastIndexOf("node_modules/")
  return marker >= 0
    ? path.slice(marker + 13)
    : path.replaceAll("previous/", "")
}
async function bundle(label, path, targetPlatform = "browser") {
  const options = {
    entryPoints: [path],
    bundle: true,
    platform: targetPlatform,
    format: "esm",
    target: "es2022",
    treeShaking: true,
    legalComments: "none",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    ...(targetPlatform === "node"
      ? {
          banner: {
            js: 'import { createRequire as __gapsCreateRequire } from "node:module"; const require = __gapsCreateRequire(import.meta.url);',
          },
        }
      : {}),
  }
  const plain = await build({ ...options, minify: false })
  const min = await build({ ...options, minify: true, metafile: true })
  const bytes = min.outputFiles[0].contents
  if (label.startsWith("candidate-")) {
    const inputs = Object.keys(min.metafile.inputs)
    const prefix = `${work}/node_modules/@near-kit/next/`
    assert(
      inputs.some((input) => resolve(root, input).startsWith(prefix)),
      "Candidate consumer did not use its packed package",
    )
    assert(
      !inputs.some((input) => resolve(root, input).startsWith(`${root}/dist/`)),
      "Consumer escaped to the checkout build",
    )
  }
  if (label.startsWith("previous-"))
    assert(
      Object.keys(min.metafile.inputs).some((input) =>
        resolve(root, input).startsWith(`${previousInstalled}/dist/`),
      ),
      "Historical consumer did not use its packed package",
    )
  const attribution = {}
  for (const output of Object.values(min.metafile.outputs))
    for (const [input, info] of Object.entries(output.inputs))
      attribution[classify(input)] =
        (attribution[classify(input)] ?? 0) + info.bytesInOutput
  await write(`bundles/${label}.min.mjs`, bytes)
  await write(`bundles/${label}.plain.mjs`, plain.outputFiles[0].contents)
  await write(`bundles/${label}.meta.json`, json(min.metafile))
  const record = {
    label,
    platform: targetPlatform,
    esbuild,
    rawBytes: plain.outputFiles[0].contents.length,
    minifiedBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
    sha256: sha(bytes),
    attribution,
    inputs: Object.keys(min.metafile.inputs),
    normalizedInputs: Object.keys(min.metafile.inputs)
      .map(normalizeInput)
      .sort(),
    externalImports: Object.values(min.metafile.outputs).flatMap(
      (x) => x.imports,
    ),
  }
  raw.bundles.push(record)
  await save()
  console.log(`Bundled ${label}`)
}
for (const label of Object.keys(entries))
  await bundle(
    label,
    join(work, "entries", `${label}.mjs`),
    label.endsWith("-server") || label.endsWith("-receipt")
      ? "node"
      : "browser",
  )
for (const label of [
  "candidate-root-read",
  "candidate-data",
  "candidate-units",
])
  await bundle(
    `previous-${label}`,
    join(work, "previous/entries", `${label}.mjs`),
  )
raw.isolation = [
  "candidate-root-read",
  "candidate-data",
  "candidate-units",
].map((label) => {
  const current = raw.bundles.find((x) => x.label === label),
    previous = raw.bundles.find((x) => x.label === `previous-${label}`)
  const cryptoInputs = current.inputs.filter(
    (x) =>
      x.includes("@noble/") ||
      x.includes("/nep413.") ||
      x.includes("/address."),
  )
  assert.deepEqual(cryptoInputs, [], `${label} gained optional crypto`)
  if (label !== "candidate-root-read")
    assert.equal(current.attribution.effect ?? 0, 0)
  return {
    label,
    cryptoInputs,
    identicalGraph:
      JSON.stringify(current.normalizedInputs) ===
      JSON.stringify(previous.normalizedInputs),
    addedInputs: current.normalizedInputs.filter(
      (x) => !previous.normalizedInputs.includes(x),
    ),
    removedInputs: previous.normalizedInputs.filter(
      (x) => !current.normalizedInputs.includes(x),
    ),
    identicalMinifiedBytes: current.sha256 === previous.sha256,
    minifiedDelta: current.minifiedBytes - previous.minifiedBytes,
    gzipDelta: current.gzipBytes - previous.gzipBytes,
    brotliDelta: current.brotliBytes - previous.brotliBytes,
  }
})
raw.ssrBundleDeltas = ["component", "hydrate", "server"].map((kind) => {
  const candidate = raw.bundles.find(
      (x) => x.label === `candidate-ssr-${kind}`,
    ),
    reference = raw.bundles.find((x) => x.label === `reference-ssr-${kind}`)
  return {
    kind,
    rawDelta: candidate.rawBytes - reference.rawBytes,
    minifiedDelta: candidate.minifiedBytes - reference.minifiedBytes,
    gzipDelta: candidate.gzipBytes - reference.gzipBytes,
    brotliDelta: candidate.brotliBytes - reference.brotliBytes,
  }
})
const exec = promisify(execFile)
async function child(
  mode,
  label,
  path,
  sampleCount = samples,
  warmupCount = warmups,
) {
  const start = performance.now()
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      join(work, "worker.mjs"),
      mode,
      path,
      label,
      String(sampleCount),
      String(warmupCount),
      work,
    ],
    {
      cwd: work,
      env: { ...process.env, NODE_ENV: "production" },
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  assert.equal(stderr.trim(), "", `Unexpected worker stderr: ${stderr}`)
  return {
    label,
    mode,
    wallMs: performance.now() - start,
    ...JSON.parse(stdout),
  }
}
const workloads = [
  "candidate-address",
  "candidate-ssr-server",
  "reference-ssr-server",
  ...(hasAuth
    ? [
        "candidate-nep413-ed25519",
        "candidate-nep413-secp256k1",
        "candidate-receipt",
      ]
    : []),
]
const entryFor = (label) =>
  label.startsWith("candidate-nep413-") ? "candidate-nep413" : label
for (const label of workloads) {
  raw.executionChecks.push(
    await child(
      "workload",
      label,
      join(work, "entries", `${entryFor(label)}.mjs`),
      1,
      0,
    ),
  )
  raw.executionChecks.push(
    await child(
      "workload",
      label,
      join(work, "bundles", `${entryFor(label)}.min.mjs`),
      1,
      0,
    ),
  )
}
for (let round = 0; round < importRounds; round++) {
  for (const label of shuffled(Object.keys(entries)))
    raw.imports.push({
      round,
      ...(await child("import", label, join(work, "entries", `${label}.mjs`))),
    })
  await save()
  console.log(`Import round ${round + 1}/${importRounds}`)
}
for (let round = 0; round < rounds; round++) {
  for (const label of shuffled(workloads))
    raw.workloads.push({
      round,
      ...(await child(
        "workload",
        label,
        join(work, "entries", `${entryFor(label)}.mjs`),
      )),
    })
  await save()
  console.log(`Workload round ${round + 1}/${rounds}`)
}
const distribution = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (p) => {
    const n = (sorted.length - 1) * p,
      i = Math.floor(n)
    return sorted[i] + (sorted[Math.ceil(n)] - sorted[i]) * (n - i)
  }
  return {
    n: sorted.length,
    min: sorted[0],
    p10: quantile(0.1),
    median: quantile(0.5),
    p90: quantile(0.9),
    p95: quantile(0.95),
    max: sorted.at(-1),
  }
}
raw.finishedAt = new Date().toISOString()
raw.retainedFiles = await files(work)
delete raw.retainedFiles["raw.json"]
await save()
const summary = {
  candidateSha256: expected,
  rawSha256: sha(await readFile(join(work, "raw.json"))),
  bundles: raw.bundles,
  isolation: raw.isolation,
  ssrBundleDeltas: raw.ssrBundleDeltas,
  costs: raw.costs,
  imports: Object.keys(entries).map((label) => {
    const rows = raw.imports.filter((row) => row.label === label)
    return {
      label,
      importMs: distribution(rows.map((x) => x.importMs)),
      wallMs: distribution(rows.map((x) => x.wallMs)),
      rssBytes: distribution(rows.map((x) => x.memory.rss)),
    }
  }),
  workloads: workloads.map((label) => {
    const rows = raw.workloads.filter((row) => row.label === label)
    return {
      label,
      timingMs: distribution(rows.flatMap((x) => x.timingsMs)),
      roundMedianMs: distribution(
        rows.map((x) => distribution(x.timingsMs).median),
      ),
      requests: rows.reduce((sum, x) => sum + x.requests, 0),
      operations: rows.reduce((sum, x) => sum + x.operations, 0),
      outputBytes: [...new Set(rows.map((x) => x.outputBytes))],
    }
  }),
}
await write("summary.json", json(summary))
console.log(
  json({
    work,
    candidateSha256: expected,
    rawSha256: summary.rawSha256,
    isolation: summary.isolation,
    workloads: summary.workloads,
  }),
)
